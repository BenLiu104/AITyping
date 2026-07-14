"""Regression tests for sensitive WebSocket query-string access-log redaction."""
from __future__ import annotations

import unittest
from unittest.mock import Mock

from api import RedactingRequestHandler, redact_request_target


class RequestLogSanitizationTests(unittest.TestCase):
    def test_redacts_websocket_token_query_string(self) -> None:
        self.assertEqual(
            redact_request_target("/ws/transcribe-v2?token=sensitive-token&extra=1"),
            "/ws/transcribe-v2",
        )

    def test_preserves_query_free_request_path(self) -> None:
        self.assertEqual(redact_request_target("/ping"), "/ping")

    def test_request_handler_logs_redacted_request_line_with_info_level(self) -> None:
        handler = object.__new__(RedactingRequestHandler)
        handler.command = "GET"
        handler.path = "/ws/transcribe-v2?token=sensitive-token"
        handler.request_version = "HTTP/1.1"
        handler.log = Mock()

        handler.log_request(200, 0)

        handler.log.assert_called_once_with(
            "info",
            '"%s" %s %s',
            "GET /ws/transcribe-v2 HTTP/1.1",
            200,
            0,
        )


if __name__ == "__main__":
    unittest.main()
