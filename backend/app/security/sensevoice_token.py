"""Compact HMAC-SHA256 signed token for the SenseVoice v2 WebSocket.

Python stdlib only (no JWT dependency). This module is the BACKEND (minting)
side of a two-party contract. The SenseVoice service ships an independent mirror
of the same scheme (``sensevoice/sensevoice_token.py``); the two Docker build
contexts are separate so they intentionally do NOT import each other. Protocol
drift between them is caught by the shared, source-controlled interoperability
vector at ``contracts/sensevoice_ws_token_vectors.json`` — both test suites
assert against it.

Token wire format (single URL-safe string, no ``.env`` secret ever logged)::

    token = base64url(canonical_json(payload)) + "." + base64url(hmac_sha256(secret, signing_input))

where ``canonical_json`` uses sorted keys and tight separators, and base64url is
unpadded. The payload carries a fixed schema version, an exact audience string,
an absolute expiry epoch and a cryptographically random nonce.
"""

from __future__ import annotations

import base64
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Dict

# Wire constants — MUST stay identical to sensevoice/sensevoice_token.py and the
# shared contract fixture. Changing any of these is a breaking protocol change.
TOKEN_VERSION = 2
TOKEN_AUDIENCE = "sensevoice-ws-v2"
_NONCE_BYTES = 16


class TokenError(Exception):
    """Base class for all token validation failures (generic, no secret echo)."""


class TokenConfigError(TokenError):
    """Raised when the shared secret is missing/invalid (fail closed → 503)."""


class TokenValidationError(TokenError):
    """Raised when a presented token is malformed/expired/tampered/wrong-audience."""


@dataclass(frozen=True)
class MintedToken:
    """Result of minting: the opaque token plus its absolute expiry epoch."""

    token: str
    expires_at: int


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _canonical_json(payload: Dict[str, Any]) -> bytes:
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def _require_secret(secret: str) -> bytes:
    if not secret or not isinstance(secret, str) or not secret.strip():
        raise TokenConfigError("token secret unavailable")
    return secret.encode("utf-8")


def _sign(secret_bytes: bytes, signing_input: str) -> str:
    digest = hmac.new(secret_bytes, signing_input.encode("ascii"), sha256).digest()
    return _b64url_encode(digest)


def mint_token(secret: str, ttl_seconds: int, *, now: int | None = None) -> MintedToken:
    """Mint a signed SenseVoice WS token.

    Raises ``TokenConfigError`` if the secret is missing/blank (caller fails
    closed with a safe 503) or ``ValueError`` if the TTL is out of bounds.
    """
    secret_bytes = _require_secret(secret)
    if not isinstance(ttl_seconds, int) or ttl_seconds <= 0:
        raise ValueError("ttl_seconds must be a positive integer")
    issued_at = int(time.time()) if now is None else int(now)
    expires_at = issued_at + ttl_seconds
    payload: Dict[str, Any] = {
        "v": TOKEN_VERSION,
        "aud": TOKEN_AUDIENCE,
        "exp": expires_at,
        "nonce": _b64url_encode(secrets.token_bytes(_NONCE_BYTES)),
    }
    signing_input = _b64url_encode(_canonical_json(payload))
    signature = _sign(secret_bytes, signing_input)
    return MintedToken(token=f"{signing_input}.{signature}", expires_at=expires_at)


def validate_token(
    secret: str, token: str, *, now: int | None = None
) -> Dict[str, Any]:
    """Validate a presented token and return its payload dict.

    Fail closed: a missing secret raises ``TokenConfigError``; any malformed,
    tampered, expired or wrong-audience token raises ``TokenValidationError``.
    The error messages are generic and never contain the presented token.
    """
    secret_bytes = _require_secret(secret)
    if not token or not isinstance(token, str) or token.count(".") != 1:
        raise TokenValidationError("malformed token")
    signing_input, presented_sig = token.split(".", 1)
    if not signing_input or not presented_sig:
        raise TokenValidationError("malformed token")

    expected_sig = _sign(secret_bytes, signing_input)
    if not hmac.compare_digest(expected_sig, presented_sig):
        raise TokenValidationError("bad signature")

    try:
        payload = json.loads(_b64url_decode(signing_input))
    except Exception as exc:  # noqa: BLE001 - collapse to a generic failure
        raise TokenValidationError("undecodable payload") from exc

    if not isinstance(payload, dict):
        raise TokenValidationError("bad payload")
    if payload.get("v") != TOKEN_VERSION:
        raise TokenValidationError("bad version")
    if payload.get("aud") != TOKEN_AUDIENCE:
        raise TokenValidationError("wrong audience")

    exp = payload.get("exp")
    if not isinstance(exp, int):
        raise TokenValidationError("bad expiry")
    current = int(time.time()) if now is None else int(now)
    if current >= exp:
        raise TokenValidationError("expired")

    nonce = payload.get("nonce")
    if not isinstance(nonce, str) or not nonce:
        raise TokenValidationError("bad nonce")
    return payload
