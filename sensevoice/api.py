"""
SenseVoice Cantonese Speech-to-Text API
Fast inference on CPU (ARM64). Returns Cantonese transcript as JSON.
"""

import io
import json
import logging
import os
import re
import tempfile
import time
import uuid
from pathlib import Path

import librosa
import soundfile as sf
import struct
import threading
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sock import Sock
from simple_websocket.errors import ConnectionClosed
from sense_voice_streaming_asr.model_data import SenseVoiceModel, VadModel
from sense_voice_streaming_asr.sense_voice_streaming_asr import SenseVoiceStreamingASR, StreamingASRConfig

# OpenCC: simplified-to-traditional Chinese conversion
_opencc = None

def get_opencc():
    global _opencc
    if _opencc is None:
        try:
            from opencc import OpenCC
            _opencc = OpenCC("s2t")  # simplified → traditional
            logger.info("OpenCC converter initialized (s2t)")
        except ImportError:
            logger.warning("OpenCC not installed, skipping traditional conversion")
            _opencc = None
    return _opencc

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    force=True,
)
logger = logging.getLogger(__name__)
TRACE_ROOT = Path("/tmp/sv-debug")

# Pinned FunASR (HF hub) model revisions — imported from model_pins.py, the
# single source of truth shared with the container build (Dockerfile preload)
# and validated by funasr_models.sha256. Keeping them at the actual runtime
# AutoModel call site guarantees the host systemd runtime and the container
# load the SAME artifacts, so the baked integrity manifest cannot drift away
# from what inference actually uses.
from model_pins import SENSEVOICE_MODEL_REVISION, FSMN_VAD_MODEL_REVISION

# WS v2 token validator (stdlib-only mirror of the backend minter; the two
# Docker contexts are separate so they do not import each other — see
# contracts/sensevoice_ws_token_vectors.json for the shared wire contract).
import sensevoice_token

app = Flask(__name__)
CORS(app)
sock = Sock(app)

# VAD model (lazy-loaded separately from STT model)
_vad_model = None
_vad_lock = threading.Lock()
_vad_ready = threading.Event()  # set when VAD model is loaded


def get_vad_model():
    global _vad_model
    with _vad_lock:
        if _vad_model is None:
            logger.info("Loading FSMN-VAD model...")
            t0 = time.time()
            from funasr import AutoModel
            _vad_model = AutoModel(
                model="fsmn-vad",
                model_revision=FSMN_VAD_MODEL_REVISION,
                hub="hf",
                disable_update=True,
            )
            logger.info(f"VAD model loaded in {time.time() - t0:.2f}s")
            _vad_ready.set()
    return _vad_model

# Global model (lazy-loaded on first request)
_model = None
_streaming_asr_model = None
_streaming_vad_model = None
_streaming_models_lock = threading.Lock()

SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus", ".webm"}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB


def get_model():
    global _model
    if _model is None:
        logger.info("Loading SenseVoiceSmall model (first request)...")
        t0 = time.time()
        from funasr import AutoModel

        _model = AutoModel(
            model="FunAudioLLM/SenseVoiceSmall",
            model_revision=SENSEVOICE_MODEL_REVISION,
            trust_remote_code=True,
            hub="hf",
            disable_update=True,
        )
        logger.info(f"Model loaded in {time.time() - t0:.2f}s")
    return _model


def get_streaming_models():
    global _streaming_asr_model, _streaming_vad_model
    with _streaming_models_lock:
        if _streaming_asr_model is None or _streaming_vad_model is None:
            logger.info("Loading incremental streaming SenseVoice models...")
            t0 = time.time()
            _streaming_asr_model = SenseVoiceModel()
            _streaming_vad_model = VadModel()
            logger.info(f"Incremental streaming models loaded in {time.time() - t0:.2f}s")
    return _streaming_asr_model, _streaming_vad_model


def normalize_streaming_language(language: str) -> str:
    normalized = (language or "").strip()
    if not normalized:
        return "yue"
    aliases = {
        "mixed": "auto",
        "auto": "auto",
        "yue": "yue",
        "zh": "zh",
        "zh-Hant": "zh",
        "zh-Hans": "zh",
        "en": "en",
        "ja": "ja",
        "ko": "ko",
    }
    return aliases.get(normalized, "auto")


def normalize_streaming_transcript(text: str) -> str:
    cleaned = text.strip()
    cc = get_opencc()
    if cc is not None and cleaned:
        cleaned = cc.convert(cleaned)
    return cleaned


class NoOpWsTraceSession:
    def update_language(self, language: str) -> None:
        pass

    def on_control(self, message: str) -> None:
        pass

    def on_chunk(self, raw_bytes: bytes) -> None:
        pass

    def on_event(self, event_name: str, text: str, is_final: bool) -> None:
        pass

    def on_end_ack(self) -> None:
        pass

    def finish(self, reason: str) -> None:
        pass


class WsTraceSession:
    def __init__(self, language: str = "yue"):
        TRACE_ROOT.mkdir(parents=True, exist_ok=True)
        self.trace_id = time.strftime("%Y%m%d-%H%M%S") + f"-{uuid.uuid4().hex[:8]}"
        self.language = language
        self.started_at = time.time()
        self.started_monotonic = time.monotonic()
        self.last_chunk_monotonic = None
        self.chunk_count = 0
        self.total_bytes = 0
        self.chunk_gaps_ms = []
        self.partial_count = 0
        self.final_count = 0
        self.end_ack_count = 0
        self.raw_audio = bytearray()
        self.closed = False
        self.jsonl_path = TRACE_ROOT / f"{self.trace_id}.jsonl"
        self.summary_path = TRACE_ROOT / f"{self.trace_id}.summary.json"
        self.wav_path = TRACE_ROOT / f"{self.trace_id}.wav"
        self.log("session_start", language=language)

    def log(self, kind: str, **fields):
        record = {
            "trace_id": self.trace_id,
            "kind": kind,
            "t_rel_ms": round((time.monotonic() - self.started_monotonic) * 1000, 1),
            **fields,
        }
        with self.jsonl_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")

    def update_language(self, language: str):
        self.language = language or "yue"
        self.log("language", language=self.language)

    def on_control(self, message: str):
        self.log("control", message=message)

    def on_chunk(self, raw_bytes: bytes):
        now = time.monotonic()
        delta_ms = None
        if self.last_chunk_monotonic is not None:
            delta_ms = round((now - self.last_chunk_monotonic) * 1000, 1)
            self.chunk_gaps_ms.append(delta_ms)
        self.last_chunk_monotonic = now
        self.chunk_count += 1
        self.total_bytes += len(raw_bytes)
        self.raw_audio.extend(raw_bytes)
        self.log(
            "chunk",
            seq=self.chunk_count,
            bytes=len(raw_bytes),
            samples=len(raw_bytes) // 2,
            delta_ms=delta_ms,
            cumulative_bytes=self.total_bytes,
        )

    def on_event(self, event_name: str, text: str, is_final: bool):
        if is_final:
            self.final_count += 1
        else:
            self.partial_count += 1
        self.log(
            "event",
            event_name=event_name,
            is_final=is_final,
            transcript_len=len(text),
            transcript_preview=text[:80],
        )

    def on_end_ack(self):
        self.end_ack_count += 1
        self.log("event", event_name="END_ACK", is_final=True, transcript_len=0, transcript_preview="")

    def finish(self, reason: str):
        if self.closed:
            return
        self.closed = True
        if self.raw_audio:
            pcm = np.frombuffer(bytes(self.raw_audio), dtype=np.int16)
            sf.write(self.wav_path, pcm, 16000, subtype="PCM_16")
        avg_gap_ms = round(sum(self.chunk_gaps_ms) / len(self.chunk_gaps_ms), 1) if self.chunk_gaps_ms else None
        max_gap_ms = max(self.chunk_gaps_ms) if self.chunk_gaps_ms else None
        summary = {
            "trace_id": self.trace_id,
            "language": self.language,
            "reason": reason,
            "duration_s": round(time.time() - self.started_at, 3),
            "chunk_count": self.chunk_count,
            "total_bytes": self.total_bytes,
            "avg_chunk_bytes": round(self.total_bytes / self.chunk_count, 1) if self.chunk_count else 0,
            "avg_gap_ms": avg_gap_ms,
            "max_gap_ms": max_gap_ms,
            "partial_count": self.partial_count,
            "final_count": self.final_count,
            "end_ack_count": self.end_ack_count,
            "jsonl_path": str(self.jsonl_path),
            "wav_path": str(self.wav_path) if self.raw_audio else None,
        }
        self.summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        self.log("session_end", **summary)
        logger.info("WS trace saved: %s", self.summary_path)


def create_ws_trace_session(language: str):
    if os.environ.get("SENSEVOICE_DEBUG_TRACE") == "1":
        return WsTraceSession(language=language)
    return NoOpWsTraceSession()


class StreamingTranscriptionBridge:
    def __init__(self, sender, processor_factory=None, trace_factory=None):
        self.sender = sender
        self.language = "yue"
        self.processor_factory = processor_factory or self._default_processor_factory
        self.processor = None
        trace_factory = trace_factory or create_ws_trace_session
        self.trace = trace_factory(self.language)

    def handle_text_message(self, message: str) -> None:
        self.trace.on_control(message)
        if message.startswith("LANG:"):
            self.language = message[5:].strip() or "yue"
            self.trace.update_language(self.language)
            logger.info("WS /ws/transcribe-v2 language set to: %s", self.language)
            return
        if message == "END":
            if self.processor is not None:
                self.processor.finalize_utterance()
            self.trace.on_end_ack()
            self.sender(json.dumps({"transcript": "", "is_final": True, "end_ack": True}))

    def handle_binary_message(self, message: bytes) -> None:
        if not message:
            return
        self.trace.on_chunk(message)
        processor = self._ensure_processor()
        pcm = np.frombuffer(message, dtype=np.int16)
        if pcm.size == 0:
            return
        audio = (pcm.astype(np.float32) / 32768.0).astype(np.float32)
        processor.accept_audio(audio)

    def _ensure_processor(self):
        if self.processor is None:
            language = normalize_streaming_language(self.language)
            self.processor = self.processor_factory(language, self._on_event)
        return self.processor

    def _default_processor_factory(self, language: str, on_event):
        asr_model, vad_model = get_streaming_models()
        processor = SenseVoiceStreamingASR(
            asr_model=asr_model,
            vad_model=vad_model,
            config=StreamingASRConfig(
                lang=language,
                asr_result_update_interval_ms=250,
                vad_end_persistence_ms=300,
            ),
        )
        processor.set_on_event_callback(on_event)
        return processor

    def _on_event(self, event_type, message: str) -> None:
        event_name = str(event_type)
        text = normalize_streaming_transcript(message)
        if not text:
            return
        if event_name.endswith("PARTIAL_RESULT"):
            self.trace.on_event(event_name, text, False)
            self.sender(json.dumps({"transcript": text, "is_final": False}))
        elif event_name.endswith("FINAL_RESULT"):
            self.trace.on_event(event_name, text, True)
            self.sender(json.dumps({"transcript": text, "is_final": True}))

    def finish(self, reason: str) -> None:
        self.trace.finish(reason)


def allowed_file(filename: str) -> bool:
    ext = Path(filename).suffix.lower()
    return ext in SUPPORTED_EXTENSIONS


def transcribe_audio(audio_path: str, language: str = "yue") -> dict:
    """
    Transcribe a single audio file using SenseVoiceSmall.
    Returns dict with transcript, timing info, and raw metadata.
    """
    model = get_model()
    t0 = time.time()

    result = model.generate(
        input=audio_path,
        language=language,
        use_itn=True,
    )

    elapsed = time.time() - t0
    raw_text = result[0]["text"]

    # Strip FunASR metadata tags (<|yue|><|NEUTRAL|><|Speech|><|withitn|>)
    transcript = raw_text
    transcript = re.sub(r"<\|[^|]+\|>", "", transcript).strip()

    # Convert simplified Chinese to traditional (Cantonese proper)
    cc = get_opencc()
    if cc is not None:
        transcript = cc.convert(transcript)

    # Parse metadata from tags
    metadata_tags = re.findall(r"<\|([^|]+)\|>", raw_text)
    detected_lang = "yue"
    emotion = "NEUTRAL"
    audio_event = "Speech"
    for tag in metadata_tags:
        if tag in ("yue", "zh", "en", "ja", "ko"):
            detected_lang = tag
        elif tag.startswith("EMO_") or tag in (
            "NEUTRAL", "HAPPY", "SAD", "ANGRY", "FEARFUL",
            "SURPRISED", "DISGUSTED",
        ):
            emotion = tag
        elif tag in ("Speech", "Music", "Applause", "Laughter"):
            audio_event = tag

    return {
        "transcript": transcript,
        "raw": raw_text,
        "detected_language": detected_lang,
        "emotion": emotion,
        "audio_event": audio_event,
        "processing_time_s": round(elapsed, 3),
    }


@app.route("/ping", methods=["GET"])
def ping():
    """Health check."""
    return jsonify({"status": "ok", "model_loaded": _model is not None})


@app.route("/transcribe", methods=["POST"])
def transcribe():
    """
    Transcribe an audio file to Cantonese text.

    Accepts:
        - multipart/form-data with 'audio' file field
        - JSON with 'url' field pointing to an audio file URL
        - JSON with 'data' field containing base64-encoded audio

    Optional parameters:
        - language (str): 'yue' (default), 'zh', 'auto'
        - format (str): output format - 'text' (default) or 'json'
    """
    audio_file = None
    language = request.form.get("language") or request.args.get("language", "yue")

    # --- Get audio data ---
    if "audio" in request.files:
        # File upload
        f = request.files["audio"]
        if not f.filename:
            return jsonify({"error": "Empty file"}), 400
        if not allowed_file(f.filename):
            return jsonify({"error": f"Unsupported format. Allowed: {', '.join(SUPPORTED_EXTENSIONS)}"}), 400

        # Save to temp file
        suffix = Path(f.filename).suffix
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        f.save(tmp.name)
        audio_file = tmp.name

    elif request.content_type and (
        request.content_type.startswith('audio/') or
        'octet-stream' in request.content_type
    ):
        # Raw binary audio (e.g. audio/wav from iOS Safari ArrayBuffer fetch)
        language = request.args.get("language", "yue")
        raw = request.data
        if not raw:
            return jsonify({"error": "Empty audio body"}), 400
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.wav')
        tmp.write(raw)
        tmp.flush()
        tmp.close()
        audio_file = tmp.name

    elif request.is_json:
        data = request.get_json(silent=True) or {}
        url = data.get("url")
        language = data.get("language", language)

        if url:
            # Download from URL
            import requests as http_req
            try:
                resp = http_req.get(url, timeout=60, stream=True)
                resp.raise_for_status()
                ext = Path(url.split("?")[0]).suffix or ".wav"
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
                for chunk in resp.iter_content(chunk_size=8192):
                    tmp.write(chunk)
                tmp.close()
                audio_file = tmp.name
            except Exception as e:
                return jsonify({"error": f"Failed to download audio: {str(e)}"}), 400
        else:
            return jsonify({"error": "No audio provided. Send file, URL, or audio data."}), 400
    else:
        return jsonify({"error": "No audio file found. Use multipart form with 'audio' field."}), 400

    if audio_file is None:
        return jsonify({"error": "Could not process audio input"}), 400

    # --- Transcribe ---
    try:
        result = transcribe_audio(audio_file, language=language)
        return jsonify(result)
    except Exception as e:
        logger.exception("Transcription failed")
        return jsonify({"error": f"Transcription failed: {str(e)}"}), 500
    finally:
        # Clean up temp file
        if audio_file and os.path.exists(audio_file):
            try:
                os.unlink(audio_file)
            except Exception:
                pass


@app.route("/transcribe_batch", methods=["POST"])
def transcribe_batch():
    """
    Transcribe multiple audio files in one request.

    Accepts multipart/form-data with multiple 'audio' fields.
    Returns array of results in same order as files.
    """
    files = request.files.getlist("audio")
    if not files:
        return jsonify({"error": "No audio files provided"}), 400

    language = request.form.get("language", "yue")
    results = []

    for f in files:
        if not f.filename or not allowed_file(f.filename):
            results.append({"filename": f.filename, "error": "Unsupported format"})
            continue

        suffix = Path(f.filename).suffix
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            f.save(tmp.name)
            r = transcribe_audio(tmp.name, language=language)
            r["filename"] = f.filename
            results.append(r)
        except Exception as e:
            results.append({"filename": f.filename, "error": str(e)})
        finally:
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)

    return jsonify({"results": results, "count": len(results)})


@sock.route("/ws/transcribe")
def ws_transcribe(ws):
    """
    WebSocket endpoint for energy-based silence-segmented transcription.

    Protocol:
      Client → Server: binary PCM frames (16kHz, 16-bit LE, mono)
                        OR text "LANG:<language>" to set language
                        OR text "END" to flush remaining buffer
      Server → Client: JSON {"transcript": "...", "is_final": true/false}
                        or  {"error": "..."}

    Segmentation: RMS energy threshold — flush when audio has been quiet
    for SILENCE_THRESHOLD_MS. Simple, predictable, no VAD streaming quirks.
    """
    SAMPLE_RATE = 16000
    ENERGY_CHUNK_MS  = 50    # evaluate energy every 50ms
    ENERGY_CHUNK_SAMPLES = int(SAMPLE_RATE * ENERGY_CHUNK_MS / 1000)
    SILENCE_RMS      = 300   # int16 RMS below this = silence (~0.9% of max)
    SILENCE_THRESHOLD_MS = 1200   # 1.2s quiet → flush as one utterance
    MAX_SEGMENT_MS   = 15000      # hard cap

    language = "yue"
    pcm_buffer      = np.array([], dtype=np.int16)
    last_flush_end  = 0   # samples already sent to SenseVoice
    last_speech_end = 0   # last sample that had speech energy
    energy_cursor   = 0   # samples already energy-evaluated

    logger.info("WS /ws/transcribe: connection opened")

    def flush_segment(pcm_segment: np.ndarray) -> None:
        """Transcribe a PCM segment and push result over WS."""
        if len(pcm_segment) < SAMPLE_RATE * 0.3:  # skip < 300ms
            return
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        try:
            import soundfile as sf_w
            sf_w.write(tmp.name, pcm_segment, SAMPLE_RATE, subtype="PCM_16")
            result = transcribe_audio(tmp.name, language=language)
            if result.get("transcript", "").strip():
                logger.info(f"flush → transcript: {result['transcript']!r}")
                ws.send(json.dumps({
                    "transcript": result["transcript"],
                    "is_final": True,
                    "processing_time_s": result.get("processing_time_s"),
                }))
        except Exception as e:
            logger.exception("WS transcription error")
            try:
                ws.send(json.dumps({"error": str(e)}))
            except Exception:
                pass
        finally:
            try:
                os.unlink(tmp.name)
            except Exception:
                pass

    try:
        while True:
            message = ws.receive()
            if message is None:
                break

            # ── Text control messages ──
            if isinstance(message, str):
                if message.startswith("LANG:"):
                    language = message[5:].strip() or "yue"
                    logger.info(f"WS language set to: {language}")
                elif message == "END":
                    # Flush remaining speech up to last detected speech
                    if last_speech_end > last_flush_end:
                        flush_segment(pcm_buffer[last_flush_end:last_speech_end])
                    ws.send(json.dumps({"transcript": "", "is_final": True, "end_ack": True}))
                continue

            # ── Binary PCM frames ──
            raw_bytes = message if isinstance(message, (bytes, bytearray)) else bytes(message)
            new_samples = np.frombuffer(raw_bytes, dtype=np.int16)
            pcm_buffer = np.concatenate([pcm_buffer, new_samples])

            # Evaluate energy in 50ms windows (incremental, not O(n²))
            new_energy_end = len(pcm_buffer) - (len(pcm_buffer) % ENERGY_CHUNK_SAMPLES)
            while energy_cursor + ENERGY_CHUNK_SAMPLES <= new_energy_end:
                chunk = pcm_buffer[energy_cursor:energy_cursor + ENERGY_CHUNK_SAMPLES]
                rms = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2)))
                if rms > SILENCE_RMS:
                    last_speech_end = energy_cursor + ENERGY_CHUNK_SAMPLES
                energy_cursor += ENERGY_CHUNK_SAMPLES

            # Silence-based flush: natural pause between utterances
            silence_samples = len(pcm_buffer) - last_speech_end
            silence_ms = silence_samples / SAMPLE_RATE * 1000
            segment_len_ms = (len(pcm_buffer) - last_flush_end) / SAMPLE_RATE * 1000

            if silence_ms >= SILENCE_THRESHOLD_MS and last_speech_end > last_flush_end:
                logger.info(f"silence flush: {silence_ms:.0f}ms quiet, "
                            f"segment={segment_len_ms:.0f}ms")
                flush_segment(pcm_buffer[last_flush_end:last_speech_end])
                last_flush_end = last_speech_end
            elif segment_len_ms >= MAX_SEGMENT_MS and last_flush_end < len(pcm_buffer):
                logger.info("max-segment flush")
                flush_segment(pcm_buffer[last_flush_end:])
                last_flush_end = len(pcm_buffer)
                last_speech_end = len(pcm_buffer)
                energy_cursor = len(pcm_buffer)

            # Trim flushed prefix to prevent buffer growing unbounded
            if last_flush_end > SAMPLE_RATE * 30:
                trim = last_flush_end
                pcm_buffer = pcm_buffer[trim:]
                last_flush_end = 0
                last_speech_end = max(0, last_speech_end - trim)
                energy_cursor = max(0, energy_cursor - trim)

    except Exception as e:
        from simple_websocket.errors import ConnectionClosed
        if isinstance(e, ConnectionClosed) and getattr(e, "status_code", None) == 1000:
            pass  # normal client disconnect
        else:
            logger.exception("WS handler error")
            try:
                ws.send(json.dumps({"error": str(e)}))
            except Exception:
                pass
    finally:
        logger.info("WS /ws/transcribe: connection closed")


@sock.route("/ws/transcribe-v2")
def ws_transcribe_v2(ws):
    """
    Incremental SenseVoice streaming endpoint (token-gated).

    Authorization: the browser cannot set WS headers, so the client appends a
    backend-signed short-lived token as the ``?token=`` query parameter. The
    token is validated BEFORE we log "connection opened", instantiate the
    StreamingTranscriptionBridge, or touch any model. Invalid/expired/wrong-
    audience/missing-secret all close the socket generically without echoing the
    token.

    Protocol (post-auth):
      Client → Server: binary PCM frames (16kHz, 16-bit LE, mono)
                        OR text "LANG:<language>"
                        OR text "END"
      Server → Client: JSON {"transcript": "...", "is_final": true/false}
                        OR {"transcript": "", "is_final": true, "end_ack": true}
                        OR {"error": "..."}
    """
    token = request.args.get("token")
    serve_ws_v2(ws, token)


def serve_ws_v2(ws, token, *, bridge_factory=None, secret=None):
    """Token-gated v2 WS session runner (transport-agnostic for testing).

    ``ws`` only needs ``receive`` / ``send`` / ``close``. ``bridge_factory`` is
    a callable ``(sender) -> bridge`` (defaults to StreamingTranscriptionBridge)
    and is NEVER called until the token validates — this is the security
    boundary the auth tests assert. ``secret`` defaults to the process env.
    """
    if secret is None:
        secret = sensevoice_token.load_secret()

    # ── Auth gate: validate BEFORE any log / bridge / model work ──────────────
    try:
        sensevoice_token.validate_token(secret, token)
    except sensevoice_token.TokenConfigError:
        # Secret absent/invalid on this side → fail closed. Do not echo token.
        logger.warning("WS /ws/transcribe-v2: rejected (token secret unavailable)")
        _safe_ws_close(ws)
        return
    except sensevoice_token.TokenValidationError:
        # Malformed/expired/tampered/wrong-audience. Generic rejection, no echo.
        logger.info("WS /ws/transcribe-v2: rejected (invalid token)")
        _safe_ws_close(ws)
        return

    # ── Authorized past this point only ───────────────────────────────────────
    logger.info("WS /ws/transcribe-v2: connection opened")
    factory = bridge_factory or (lambda sender: StreamingTranscriptionBridge(sender=sender))
    bridge = factory(ws.send)

    try:
        while True:
            message = ws.receive()
            if message is None:
                break
            if isinstance(message, str):
                bridge.handle_text_message(message)
                continue
            raw_bytes = message if isinstance(message, (bytes, bytearray)) else bytes(message)
            bridge.handle_binary_message(raw_bytes)
    except ConnectionClosed:
        bridge.finish("client_disconnected")
        logger.info("WS /ws/transcribe-v2: client disconnected")
    except Exception as e:
        bridge.finish(f"error:{type(e).__name__}")
        logger.exception("WS /ws/transcribe-v2 error")
        try:
            ws.send(json.dumps({"error": str(e)}))
        except Exception:
            pass
    finally:
        bridge.finish("connection_closed")
        logger.info("WS /ws/transcribe-v2: connection closed")


def _safe_ws_close(ws) -> None:
    """Send a generic error + close, never echoing the presented token."""
    try:
        ws.send(json.dumps({"error": "unauthorized"}))
    except Exception:
        pass
    try:
        ws.close(1008)
    except Exception:
        pass


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="SenseVoice Cantonese STT API")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind")
    parser.add_argument("--port", type=int, default=8082, help="Port to bind")
    parser.add_argument("--preload", action="store_true", help="Preload model on startup")
    args = parser.parse_args()

    if args.preload:
        logger.info("Preloading STT + VAD models...")
        import threading as _t
        _t.Thread(target=get_vad_model, daemon=True).start()
        get_model()
        get_streaming_models()

    logger.info(f"Starting API server on {args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=False)
