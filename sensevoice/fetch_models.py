#!/usr/bin/env python3
"""Fetch SenseVoice ONNX models from ModelScope into the installed
sense_voice_streaming_asr package.

Why this exists:
  The wrapper bundles its models as ModelScope git submodules. Installing the
  wrapper via `pip install git+...` does NOT init submodules, so the model files
  arrive as tiny Git LFS / submodule placeholders and onnxruntime fails with
  InvalidProtobuf. This downloads the real weights from the canonical upstream
  (Alibaba DAMO `iic/*` on ModelScope) at pinned revisions.

Correctness is guaranteed by sensevoice/models.sha256 (checked by setup.sh),
not by trusting the download — pinned revision is for reproducibility only.

Usage:
    python fetch_models.py [--models-dir DIR]
  --models-dir defaults to the installed package's models/ directory.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

# Canonical ModelScope sources (same repos the wrapper's submodules point at).
# Revision pinned to the submodule commits for reproducibility.
MODELS = {
    "SenseVoiceSmall": {
        "repo": "iic/SenseVoiceSmall-onnx",
        "revision": "0dd101a91bcf61c26dd778ddf634d8989afe22e3",
        "files": ["model_quant.onnx", "am.mvn", "configuration.json", "tokens.json"],
    },
    "speech_fsmn_vad_zh-cn-16k-common-onnx": {
        "repo": "iic/speech_fsmn_vad_zh-cn-16k-common-onnx",
        "revision": "a158155ef9e81f405c052f40b6d1ad43b87e6215",
        "files": ["model_quant.onnx", "am.mvn", "configuration.json"],
    },
}


def default_models_dir() -> str:
    import sense_voice_streaming_asr  # noqa: WPS433 (import inside fn is intentional)

    return os.path.join(os.path.dirname(sense_voice_streaming_asr.__file__), "models")


def fetch(models_dir: str) -> None:
    from modelscope import snapshot_download

    for subdir, spec in MODELS.items():
        dest = os.path.join(models_dir, subdir)
        os.makedirs(dest, exist_ok=True)
        print(f"==> Downloading {spec['repo']}@{spec['revision'][:8]}")
        try:
            snap = snapshot_download(
                spec["repo"],
                revision=spec["revision"],
                allow_file_pattern=spec["files"],
            )
        except Exception as exc:  # noqa: BLE001 — surface any download failure clearly
            print(f"ERROR: failed to download {spec['repo']}: {exc}", file=sys.stderr)
            raise SystemExit(1) from exc

        for fname in spec["files"]:
            src = os.path.join(snap, fname)
            if not os.path.exists(src):
                print(f"ERROR: {fname} missing in {spec['repo']} snapshot", file=sys.stderr)
                raise SystemExit(1)
            shutil.copyfile(src, os.path.join(dest, fname))
            print(f"    placed {subdir}/{fname}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-dir", default=None,
                        help="target models/ dir (default: installed package)")
    args = parser.parse_args()
    models_dir = args.models_dir or default_models_dir()
    print(f"==> Target models dir: {models_dir}")
    fetch(models_dir)
    print("==> Model fetch complete (verify with sensevoice/models.sha256)")


if __name__ == "__main__":
    main()
