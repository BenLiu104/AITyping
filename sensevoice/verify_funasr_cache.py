#!/usr/bin/env python3
"""Verify baked FunASR (HF hub) model cache against funasr_models.sha256.

Why this exists:
  The container Dockerfile preloads FunASR SenseVoiceSmall + FSMN-VAD (.pt)
  at pinned revisions and bakes the HF hub cache into the image. Without an
  integrity check the baked weights could silently drift (wrong revision, a
  truncated download, or an LFS pointer) and the image would still build. This
  script hashes the actual cached blobs (resolving HF's blob symlinks) and
  fail-hard on any mismatch, in the same spirit as models.sha256 does for the
  streaming ONNX package.

  This complements — does NOT replace — models.sha256, which validates the
  streaming ONNX weights from the installed package directory.

Usage:
    python verify_funasr_cache.py [--hub-root DIR] [--manifest FILE]
  --hub-root defaults to $HF_HOME/hub (or ~/.cache/huggingface/hub).
  --manifest defaults to funasr_models.sha256 next to this script.

Exit codes: 0 = all match, 1 = any missing/mismatch/parse error.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys


def default_hub_root() -> str:
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return os.path.join(hf_home, "hub")
    return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def parse_manifest(path: str) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(None, 1)
            if len(parts) != 2:
                print(f"ERROR: malformed manifest line: {raw!r}", file=sys.stderr)
                raise SystemExit(1)
            digest, rel = parts[0], parts[1].strip()
            entries.append((digest, rel))
    return entries


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hub-root", default=None, help="HF hub root (default: $HF_HOME/hub)")
    parser.add_argument(
        "--manifest",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "funasr_models.sha256"),
        help="manifest path (default: funasr_models.sha256 next to this script)",
    )
    args = parser.parse_args()
    hub_root = args.hub_root or default_hub_root()

    entries = parse_manifest(args.manifest)
    if not entries:
        print("ERROR: manifest is empty", file=sys.stderr)
        raise SystemExit(1)

    print(f"==> Verifying {len(entries)} FunASR artifacts under {hub_root}")
    failures = 0
    for expected, rel in entries:
        # HF stores blobs behind per-file symlinks; resolve to the real blob.
        target = os.path.realpath(os.path.join(hub_root, rel))
        if not os.path.exists(target):
            print(f"MISSING  {rel}", file=sys.stderr)
            failures += 1
            continue
        actual = sha256_of(target)
        if actual != expected:
            print(f"MISMATCH {rel}\n  expected {expected}\n  actual   {actual}", file=sys.stderr)
            failures += 1
        else:
            print(f"OK       {rel}")

    if failures:
        print(f"==> FAILED: {failures} artifact(s) did not match", file=sys.stderr)
        raise SystemExit(1)
    print("==> All FunASR baked artifacts verified.")


if __name__ == "__main__":
    main()
