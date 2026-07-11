"""Regression tests for sensitive WebSocket query-string access-log redaction."""
from __future__ import annotations

import unittest

from api import redact_request_target


class RequestLogSanitizationTests(unittest.TestCase):
    def test_redacts_websocket_token_query_string(self) -> None:
        self.assertEqual(
            redact_request_target("/ws/transcribe-v2?token=sensitive-token&extra=1"),
            "/ws/transcribe-v2",
        )

    def test_preserves_query_free_request_path(self) -> None:
        self.assertEqual(redact_request_target("/ping"), "/ping")


if __name__ == "__main__":
    unittest.main()
