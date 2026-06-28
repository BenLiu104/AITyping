import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()
logger = logging.getLogger("aityping.debug")


class DebugEvent(BaseModel):
    phase: str = Field(..., max_length=40)
    build: str = Field(..., max_length=20)
    wsOpen: bool = False
    setupComplete: bool = False
    audioChunks: int = Field(default=0, ge=0)
    audioBytes: int = Field(default=0, ge=0)
    audioSent: int = Field(default=0, ge=0)
    transcriptEvents: int = Field(default=0, ge=0)
    lastCloseCode: Optional[int] = None
    lastCloseReason: str = Field(default="", max_length=160)
    lastError: str = Field(default="", max_length=200)

    model_config = {"extra": "forbid"}


@router.post("/debug-event", tags=["Debug"])
async def debug_event(payload: DebugEvent):
    """Log non-content client telemetry for iPhone Live debugging.

    This intentionally does not accept raw transcript, audio, token, or user text.
    """
    logger.warning(
        "AITYPE_DEBUG phase=%s build=%s wsOpen=%s setupComplete=%s audioChunks=%s "
        "audioBytes=%s audioSent=%s transcriptEvents=%s closeCode=%s closeReason=%r error=%r",
        payload.phase,
        payload.build,
        payload.wsOpen,
        payload.setupComplete,
        payload.audioChunks,
        payload.audioBytes,
        payload.audioSent,
        payload.transcriptEvents,
        payload.lastCloseCode,
        payload.lastCloseReason,
        payload.lastError,
    )
    return {"ok": True}
