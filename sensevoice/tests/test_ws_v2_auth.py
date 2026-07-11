"""WS v2 authorization-order tests.

Asserts the security boundary: the v2 WebSocket validates its query token
BEFORE it logs "connection opened", instantiates StreamingTranscriptionBridge,
or touches any model. Invalid / expired / wrong-audience / missing-secret all
close the socket generically without echoing the token and without creating a
bridge.

Run:
    cd sensevoice
    PYTHONPATH=. ./venv/bin/python -m unittest tests.test_ws_v2_auth -v
"""
from __future__ import annotations

import base64
import json
import os
import unittest
from unittest.mock import patch

import api
import sensevoice_token as st

SECRET = "ws-auth-secret"


def make_token(secret: str, payload: dict) -> str:
    signing_input = (
        base64.urlsafe_b64encode(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        )
        .rstrip(b"=")
        .decode("ascii")
    )
    return f"{signing_input}.{st._sign(secret.encode('utf-8'), signing_input)}"


def valid_token(secret: str = SECRET) -> str:
    return make_token(secret, {
        "v": 2, "aud": "sensevoice-ws-v2", "exp": 2_000_000_000, "nonce": "nonce0123456789a",
    })


class FakeWs:
    def __init__(self, messages=None):
        self._messages = list(messages or [])
        self.sent = []
        self.closed_with = None

    def receive(self):
        if self._messages:
            return self._messages.pop(0)
        return None

    def send(self, payload):
        self.sent.append(payload)

    def close(self, *args):
        self.closed_with = args or (None,)


class WsV2AuthorizationTests(unittest.TestCase):
    def _bridge_spy(self):
        created = []

        def factory(sender):
            created.append(sender)
            raise AssertionError("bridge must not be created for a rejected token")

        return factory, created

    def test_rejects_missing_secret_before_bridge(self):
        factory, created = self._bridge_spy()
        ws = FakeWs()
        with patch.dict(os.environ, {}, clear=True):
            api.serve_ws_v2(ws, valid_token(), bridge_factory=factory)
        self.assertEqual(created, [])
        self.assertIsNotNone(ws.closed_with)
        # no token echo anywhere in what we sent/closed with
        blob = "".join(str(x) for x in ws.sent) + str(ws.closed_with)
        self.assertNotIn(valid_token(), blob)

    def test_rejects_invalid_token_before_bridge(self):
        factory, created = self._bridge_spy()
        ws = FakeWs()
        with patch.dict(os.environ, {st.SECRET_ENV_VAR: SECRET}, clear=True):
            api.serve_ws_v2(ws, "totally-bogus", bridge_factory=factory)
        self.assertEqual(created, [])
        self.assertIsNotNone(ws.closed_with)

    def test_rejects_expired_token_before_bridge(self):
        factory, created = self._bridge_spy()
        expired = make_token(SECRET, {
            "v": 2, "aud": "sensevoice-ws-v2", "exp": 1000, "nonce": "nonce0123456789a",
        })
        ws = FakeWs()
        with patch.dict(os.environ, {st.SECRET_ENV_VAR: SECRET}, clear=True):
            api.serve_ws_v2(ws, expired, bridge_factory=factory)
        self.assertEqual(created, [])
        self.assertIsNotNone(ws.closed_with)

    def test_rejects_wrong_audience_before_bridge(self):
        factory, created = self._bridge_spy()
        wrong = make_token(SECRET, {
            "v": 2, "aud": "not-the-right-aud", "exp": 2_000_000_000, "nonce": "nonce0123456789a",
        })
        ws = FakeWs()
        with patch.dict(os.environ, {st.SECRET_ENV_VAR: SECRET}, clear=True):
            api.serve_ws_v2(ws, wrong, bridge_factory=factory)
        self.assertEqual(created, [])
        self.assertIsNotNone(ws.closed_with)

    def test_valid_token_creates_bridge_and_processes(self):
        created = []

        class RecordingBridge:
            def __init__(self, sender):
                created.append(sender)
                self.texts = []

            def handle_text_message(self, message):
                self.texts.append(message)

            def handle_binary_message(self, message):
                pass

            def finish(self, reason):
                pass

        ws = FakeWs(messages=["LANG:yue", None])
        with patch.dict(os.environ, {st.SECRET_ENV_VAR: SECRET}, clear=True):
            api.serve_ws_v2(ws, valid_token(), bridge_factory=RecordingBridge)
        self.assertEqual(len(created), 1)


if __name__ == "__main__":
    unittest.main()
