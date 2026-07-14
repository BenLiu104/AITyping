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
    PYTHONUNBUFFERED=1

# ── Python deps (install as root into system site-packages) ──────────────────
# Copy only requirement file first so this layer is cached independently of
# source / model changes.
COPY requirements.txt ./

# modelscope is pinned in requirements.txt (imported directly by fetch_models.py),
# so no separate unpinned pip install is needed here.
RUN pip install --no-cache-dir -r requirements.txt

# ── Model-preparation inputs ONLY (copy before expensive model layers) ───────
# Copy just the files the streaming model download / integrity steps need, so
# those slow layers stay cached across api.py / tests edits. api.py and tests
# are intentionally copied LATER (after all model layers) — a source change must
# not bust the multi-minute model fetch/verify layer.
COPY fetch_models.py models.sha256 ./

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

# ── Source files (copy LAST — after all expensive model layers) ──────────────
# Editing api.py / tests must NOT invalidate the model fetch/verify
# layers above, so these are the final COPY before ownership + runtime.
COPY api.py sensevoice_token.py ./
COPY tests/ ./tests/

# Transfer ownership of app dir to the non-root user
RUN chown -R user:user /home/user/app

# ── Switch to non-root user for runtime ──────────────────────────────────────
USER user

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 7860

# --preload is supported by api.py (--host / --port / --preload).
# Models are baked in; --preload validates the streaming weights before serving.
CMD ["python", "api.py", "--host", "0.0.0.0", "--port", "7860", "--preload"]
