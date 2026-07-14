"""
SenseVoice Cantonese Speech-to-Text API
Fast inference on CPU (ARM64). Returns Cantonese transcript as JSON.
"""

import json
import logging
import os
import time
import uuid
from pathlib import Path

import soundfile as sf
import threading
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sock import Sock
from simple_websocket.errors import ConnectionClosed
from werkzeug.serving import WSGIRequestHandler
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


def redact_request_target(path: str) -> str:
    """Keep Werkzeug access logs useful without persisting WS query tokens."""
    return path.split("?", 1)[0]


class RedactingRequestHandler(WSGIRequestHandler):
    """Werkzeug development-server handler that never logs URL query strings."""

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        request_line = f"{self.command} {redact_request_target(self.path)} {self.request_version}"
        self.log("info", '"%s" %s %s', request_line, code, size)


TRACE_ROOT = Path("/tmp/sv-debug")

# WS v2 token validator (stdlib-only mirror of the backend minter; the two
# Docker contexts are separate so they do not import each other — see
# contracts/sensevoice_ws_token_vectors.json for the shared wire contract).
import sensevoice_token

app = Flask(__name__)
CORS(app)
sock = Sock(app)

_streaming_asr_model = None
_streaming_vad_model = None
_streaming_models_lock = threading.Lock()


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


@app.route("/ping", methods=["GET"])
def ping():
    """Health check."""
    return jsonify({"status": "ok", "model_loaded": _streaming_asr_model is not None})


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
            ws.send(json.dumps({"error": "internal error"}))
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
        logger.info("Preloading streaming STT + VAD models...")
        get_streaming_models()

    logger.info(f"Starting API server on {args.host}:{args.port}")
    app.run(
        host=args.host,
        port=args.port,
        debug=False,
        request_handler=RedactingRequestHandler,
    )
