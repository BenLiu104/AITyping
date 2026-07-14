"""Build contract for the streaming-only SenseVoice runtime."""
from __future__ import annotations

from pathlib import Path
import unittest


SENSEVOICE_DIR = Path(__file__).resolve().parents[1]


class StreamingOnlyRuntimeTests(unittest.TestCase):
    def test_build_no_longer_contains_full_funasr_model_stack(self) -> None:
        dockerfile = (SENSEVOICE_DIR / "Dockerfile").read_text(encoding="utf-8")
        requirements = (SENSEVOICE_DIR / "requirements.txt").read_text(encoding="utf-8")

        self.assertNotIn("funasr", dockerfile.lower())
        self.assertNotIn("AutoModel", dockerfile)
        self.assertNotIn("funasr==", requirements)
        self.assertNotIn("torch==", requirements)
        self.assertNotIn("torchaudio==", requirements)
        self.assertFalse((SENSEVOICE_DIR / "model_pins.py").exists())
        self.assertFalse((SENSEVOICE_DIR / "funasr_models.sha256").exists())
        self.assertFalse((SENSEVOICE_DIR / "verify_funasr_cache.py").exists())


if __name__ == "__main__":
    unittest.main()
