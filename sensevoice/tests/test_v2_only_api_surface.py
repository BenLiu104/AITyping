"""Public API contract for the v2-only SenseVoice service."""
from __future__ import annotations

import unittest

import api


class V2OnlyApiSurfaceTests(unittest.TestCase):
    def test_exposes_only_ping_and_token_gated_v2_websocket(self) -> None:
        rules = {rule.rule for rule in api.app.url_map.iter_rules()}

        self.assertEqual(
            rules,
            {"/ping", "/static/<path:filename>", "/ws/transcribe-v2"},
        )


if __name__ == "__main__":
    unittest.main()
