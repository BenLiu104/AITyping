# SenseVoice STT API — Container image
#
# Build context: ./sensevoice   (docker compose build context)
# Target:        local ARM64 Docker (aarch64).  x86/HF validation pending.
#
# Notes:
#   - Models are baked into the image at build time (no mounted cache volume).
#     A runtime bind-mount of ~/.cache/huggingface into /home/user/.cache/huggingface
#     is OPTIONAL for faster rebuilds but will MASK the baked model copy silently;
#     omit the mount unless you know what you are doing.
#   - The image exposes port 7860 (HF Spaces convention). Map to host as needed.
#   - No secrets are baked in.  SENSEVOICE_DEBUG_TRACE remains off by default.

FROM python:3.11-slim

# ── System deps ──────────────────────────────────────────────────────────────
# libsndfile1  : soundfile / libsndfile C backend
# libgomp1     : OpenMP used by onnxruntime CPU inference
# git          : pip install git+... (sense-voice-streaming-asr)
# ca-certificates: HTTPS downloads (ModelScope, HuggingFace)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libsndfile1 \
        libgomp1 \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ── Non-root user (UID 1000, required by HF Spaces) ──────────────────────────
RUN useradd -m -u 1000 user
WORKDIR /home/user/app

# ── Environment ──────────────────────────────────────────────────────────────
ENV HOME=/home/user \
    PATH="/home/user/.local/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/home/user/.cache/huggingface \
    TRANSFORMERS_CACHE=/home/user/.cache/huggingface/transformers \
    FUNASR_CACHE=/home/user/.cache/funasr

# ── Python deps (install as root into system site-packages) ──────────────────
# Copy only requirement file first so this layer is cached independently of
# source / model changes.
COPY requirements.txt ./

# torch CPU wheels live on download.pytorch.org, not PyPI.
# modelscope is pinned in requirements.txt (imported directly by fetch_models.py),
# so no separate unpinned pip install is needed here.
RUN pip install --no-cache-dir \
        --extra-index-url https://download.pytorch.org/whl/cpu \
        -r requirements.txt

# ── Model-preparation inputs ONLY (copy before expensive model layers) ───────
# Copy just the files the model download / preload / integrity steps need, so
# those slow layers stay cached across api.py / tests edits. api.py and tests
# are intentionally copied LATER (after all model layers) — a source change must
# not bust the multi-minute model fetch/preload/verify layers.
COPY fetch_models.py models.sha256 funasr_models.sha256 verify_funasr_cache.py model_pins.py ./

# ── Fetch streaming ONNX models into the installed package ───────────────────
# Run as root: pip installed the package into /usr/local/lib, so writes to
# site-packages/sense_voice_streaming_asr/models/ require root.
# The models directory is world-readable after fetch.
RUN python fetch_models.py \
    && MODELS_DIR=$(python -c \
        'import sense_voice_streaming_asr, os; \
         print(os.path.join(os.path.dirname(sense_voice_streaming_asr.__file__), "models"))') \
    && cd "$MODELS_DIR" \
    && sha256sum -c /home/user/app/models.sha256

# ── Pre-fetch FunASR / HuggingFace models (bake into image) ──────────────────
# Load SenseVoiceSmall + FSMN-VAD weights without starting a server, at the SAME
# pinned revisions api.py uses at runtime (model_revision=...). HF cache lands
# under /home/user/.cache/huggingface (writable as root, owned by root — chown
# to user afterwards so the runtime user can read the cache).
RUN python - <<'PYEOF'
import logging, time
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("preload")
# Import pins from the shared single-source module (no Flask/model import).
from model_pins import SENSEVOICE_MODEL_REVISION as sv_rev, FSMN_VAD_MODEL_REVISION as vad_rev
logger.info(f"Preloading FunASR SenseVoiceSmall (HF hub) @ {sv_rev[:8]}...")
t0 = time.time()
from funasr import AutoModel
m = AutoModel(model="FunAudioLLM/SenseVoiceSmall", model_revision=sv_rev, trust_remote_code=True, hub="hf", disable_update=True)
logger.info(f"SenseVoiceSmall loaded in {time.time()-t0:.1f}s")
logger.info(f"Preloading FSMN-VAD (HF hub) @ {vad_rev[:8]}...")
t1 = time.time()
v = AutoModel(model="fsmn-vad", model_revision=vad_rev, hub="hf", disable_update=True)
logger.info(f"FSMN-VAD loaded in {time.time()-t1:.1f}s")
logger.info("Preloading streaming ONNX models...")
t2 = time.time()
from sense_voice_streaming_asr.model_data import SenseVoiceModel, VadModel
SenseVoiceModel()
VadModel()
logger.info(f"Streaming models loaded in {time.time()-t2:.1f}s")
logger.info("All models baked into image.")
PYEOF

# ── Verify baked FunASR cache integrity (fail-hard on drift) ─────────────────
# Confirms the baked .pt artifacts match funasr_models.sha256 (the exact pinned
# revisions), catching a wrong-revision download or truncated blob at build time.
RUN python verify_funasr_cache.py

# ── Source files (copy LAST — after all expensive model layers) ──────────────
# Editing api.py / tests must NOT invalidate the model fetch/preload/verify
# layers above, so these are the final COPY before ownership + runtime.
COPY api.py sensevoice_token.py ./
COPY tests/ ./tests/

# Transfer ownership of app dir + HF cache to the non-root user
RUN chown -R user:user /home/user/app /home/user/.cache

# ── Switch to non-root user for runtime ──────────────────────────────────────
USER user

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 7860

# --preload is supported by api.py (--host / --port / --preload).
# Models are already baked in, but --preload still runs the in-process warm-up
# which validates the baked weights are loadable before accepting requests.
CMD ["python", "api.py", "--host", "0.0.0.0", "--port", "7860", "--preload"]
