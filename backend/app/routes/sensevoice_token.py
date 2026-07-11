"""SenseVoice v2 WebSocket token mint endpoint.

`POST /api/sensevoice-token` → `{token, expiresAt}` with `Cache-Control:
no-store`. The token is a compact HMAC-SHA256 signed payload (see
``app.security.sensevoice_token``). Fails closed with a safe 503 when the shared
secret is missing/invalid; never echoes the secret or a token into logs/errors.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.core.config import settings
from app.security import sensevoice_token as st

logger = logging.getLogger(__name__)

router = APIRouter()

# Bounds for the configured TTL so a misconfigured .env cannot mint absurdly
# long-lived tokens (defence in depth alongside the 60s default).
_MIN_TTL = 5
_MAX_TTL = 300
_NO_STORE = {"Cache-Control": "no-store"}
_UNAVAILABLE = "SenseVoice secure connection unavailable; please try again later"


class SenseVoiceTokenResponse(BaseModel):
    token: str = Field(..., description="Signed SenseVoice v2 WS token")
    expiresAt: int = Field(..., description="Absolute expiry (epoch seconds)")


@router.post("/sensevoice-token", tags=["SenseVoice"])
async def mint_sensevoice_token() -> JSONResponse:
    ttl = settings.SENSEVOICE_WS_TOKEN_TTL
    if not isinstance(ttl, int) or ttl <= 0:
        ttl = 60
    ttl = max(_MIN_TTL, min(_MAX_TTL, ttl))

    try:
        minted = st.mint_token(settings.SENSEVOICE_WS_TOKEN_SECRET, ttl_seconds=ttl)
    except st.TokenConfigError:
        # Fail closed: the shared secret is missing/invalid. Do not leak why.
        logger.warning("SenseVoice token mint unavailable: secret not configured")
        return JSONResponse(
            status_code=503, content={"detail": _UNAVAILABLE}, headers=_NO_STORE
        )
    except Exception:
        # Never echo internal error detail (could carry secret-like values).
        logger.exception("SenseVoice token mint failed")
        return JSONResponse(
            status_code=503, content={"detail": _UNAVAILABLE}, headers=_NO_STORE
        )

    payload = SenseVoiceTokenResponse(token=minted.token, expiresAt=minted.expires_at)
    return JSONResponse(
        status_code=200, content=payload.model_dump(), headers=_NO_STORE
    )
