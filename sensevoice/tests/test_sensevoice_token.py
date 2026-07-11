"""Tests for the SenseVoice-side WS token validator.

Stdlib-only import surface (does NOT import api / funasr / librosa), so these run
fast and in isolation. Covers valid / expired / tampered / wrong-audience /
missing-secret rejection, plus the shared interoperability vector that both the
backend minter and this validator must agree on.

Run:
    cd sensevoice
    PYTHONPATH=. ./venv/bin/python -m unittest tests.test_sensevoice_token -v
"""
from __future__ import annotations

import base64
import json
import os
import unittest

import sensevoice_token as st

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
CONTRACT_VECTOR = os.path.join(
    REPO_ROOT, "contracts", "sensevoice_ws_token_vectors.json"
)


def load_vector():
    with open(CONTRACT_VECTOR, encoding="utf-8") as fh:
        return json.load(fh)


def make_token(secret: str, payload: dict) -> str:
    signing_input = (
        base64.urlsafe_b64encode(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        )
        .rstrip(b"=")
        .decode("ascii")
    )
    return f"{signing_input}.{st._sign(secret.encode('utf-8'), signing_input)}"


VALID_PAYLOAD = {
    "v": 2,
    "aud": "sensevoice-ws-v2",
    "exp": 2_000_000_000,
    "nonce": "abcdEFGH12345678",
}


class SenseVoiceTokenValidatorTests(unittest.TestCase):
    SECRET = "unit-secret"

    def test_valid_token_accepted(self):
        token = make_token(self.SECRET, VALID_PAYLOAD)
        payload = st.validate_token(self.SECRET, token, now=1_999_999_000)
        self.assertEqual(payload["aud"], "sensevoice-ws-v2")

    def test_expired_token_rejected(self):
        token = make_token(self.SECRET, {**VALID_PAYLOAD, "exp": 1_000})
        with self.assertRaises(st.TokenValidationError):
            st.validate_token(self.SECRET, token, now=1_000)

    def test_tampered_token_rejected(self):
        token = make_token(self.SECRET, VALID_PAYLOAD)
        tampered = token[:-2] + ("aa" if not token.endswith("aa") else "bb")
        with self.assertRaises(st.TokenValidationError):
            st.validate_token(self.SECRET, tampered, now=1_999_999_000)

    def test_wrong_audience_rejected(self):
        token = make_token(self.SECRET, {**VALID_PAYLOAD, "aud": "some-other-aud"})
        with self.assertRaises(st.TokenValidationError):
            st.validate_token(self.SECRET, token, now=1_999_999_000)

    def test_wrong_secret_rejected(self):
        token = make_token(self.SECRET, VALID_PAYLOAD)
        with self.assertRaises(st.TokenValidationError):
            st.validate_token("different-secret", token, now=1_999_999_000)

    def test_missing_secret_fails_closed(self):
        token = make_token(self.SECRET, VALID_PAYLOAD)
        with self.assertRaises(st.TokenConfigError):
            st.validate_token("", token, now=1_999_999_000)
        with self.assertRaises(st.TokenConfigError):
            st.validate_token(None, token, now=1_999_999_000)

    def test_malformed_token_rejected(self):
        for bad in ("", "no-dot", "a.b.c", ".", "x."):
            with self.assertRaises(st.TokenValidationError):
                st.validate_token(self.SECRET, bad, now=1_999_999_000)

    def test_matches_shared_contract_vector(self):
        v = load_vector()
        payload = st.validate_token(v["secret"], v["token"], now=v["payload"]["exp"] - 1)
        self.assertEqual(payload, v["payload"])
        signing_input, signature = v["token"].split(".", 1)
        self.assertEqual(
            st._sign(v["secret"].encode("utf-8"), signing_input), signature
        )
        self.assertEqual(signature, v["signature"])


if __name__ == "__main__":
    unittest.main()
