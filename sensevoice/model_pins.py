"""Pinned FunASR (HF hub) model revisions — single source of truth.

Both the runtime (api.py) and the container build (Dockerfile preload) import
these constants so the host systemd runtime and the baked image load the exact
same artifacts. These revisions are validated by funasr_models.sha256.

Kept dependency-free (stdlib only) so the Dockerfile can copy just this file —
not api.py / Flask — before the expensive model-download layers, preserving
build-cache reuse when api.py changes.
"""

# FunAudioLLM/SenseVoiceSmall snapshot commit (HF hub).
SENSEVOICE_MODEL_REVISION = "3847d57b6bdf2dd8875cb1508d2af43d80a16bf7"

# funasr/fsmn-vad snapshot commit (HF hub).
FSMN_VAD_MODEL_REVISION = "df20e6b30c653645fa4ff125cacfcabd1020a669"
