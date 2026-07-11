"""SenseVoice-side validator for the v2 WebSocket HMAC token.

Independent mirror of the backend minting module
(``backend/app/security/sensevoice_token.py``). The two Docker build contexts
are separate, so this file MUST NOT import the backend and the backend MUST NOT
import this. The shared, source-controlled interoperability vector at
``contracts/sensevoice_ws_token_vectors.json`` (asserted by BOTH test suites)
guarantees the two independent implementations stay wire-compatible.

This side only needs to VALIDATE (it never mints), and it fails closed: a
missing/blank secret or any malformed/expired/tampered/wrong-audience token is
rejected with a generic error that never echoes the presented token.
"""

from __future__ import annotations

import base64
import hmac
import json
import os
import time
from hashlib import sha256
from typing import Any, Dict, Optional

# Wire constants — identical to backend/app/security/sensevoice_token.py.
TOKEN_VERSION = 2
TOKEN_AUDIENCE = "sensevoice-ws-v2"
SECRET_ENV_VAR = "SENSEVOICE_WS_TOKEN_SECRET"


class TokenConfigError(Exception):
    """Shared secret missing/invalid — fail closed, do not open the socket."""


class TokenValidationError(Exception):
    """Token malformed/expired/tampered/wrong-audience — reject generically."""


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _sign(secret_bytes: bytes, signing_input: str) -> str:
    digest = hmac.new(secret_bytes, signing_input.encode("ascii"), sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _require_secret(secret: Optional[str]) -> bytes:
    if not secret or not isinstance(secret, str) or not secret.strip():
        raise TokenConfigError("token secret unavailable")
    return secret.encode("utf-8")


def load_secret() -> Optional[str]:
    """Read the shared secret from the environment (never logged)."""
    return os.environ.get(SECRET_ENV_VAR)


def validate_token(
    secret: Optional[str], token: Optional[str], *, now: Optional[int] = None
) -> Dict[str, Any]:
    """Validate a presented WS token, returning its payload dict on success.

    Raises ``TokenConfigError`` when the secret is absent (fail closed) and
    ``TokenValidationError`` for any bad token. Neither message contains the
    token value.
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
    except Exception as exc:  # collapse to a generic failure
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
