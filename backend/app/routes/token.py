from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Optional
from app.gemini.adapter import GeminiAdapter

router = APIRouter()


def get_gemini_adapter() -> GeminiAdapter:
    return GeminiAdapter()


class TokenResponse(BaseModel):
    token: str = Field(..., description="Gemini Live API ephemeral token (短效 Token)")
    expiresAt: str = Field(
        ..., alias="expiresAt", description="Token 失效時間 (ISO-8601 格式)"
    )
    model: str = Field(..., description="對應的 Live API WebSocket 模型名稱")

    model_config = {
        "populate_by_name": True,
        "json_schema_extra": {
            "example": {
                "token": "mock_ephemeral_token_xyz123",
                "expiresAt": "2026-06-27T12:00:00Z",
                "model": "models/gemini-3.1-flash-live-preview",
            }
        },
    }


@router.post("/live-token", response_model=TokenResponse, tags=["Gemini"])
async def get_live_token(
    ttl: Optional[int] = Query(default=None, ge=1),
    profile: Optional[str] = Query(
        default=None,
        description="轉錄語言 profile：english / cantonese / cantonese-english / auto",
    ),
    adapter: GeminiAdapter = Depends(get_gemini_adapter),
):
    """簽發用於前端瀏覽器直連 Gemini Live API WebSocket 的短效 Ephemeral Token

    profile 依前端語言模式將對應轉錄指令鎖入 token 的 live_connect_constraints；
    未知或缺省的 profile 一律回退為通用轉錄指令（不 fail）。
    """
    normalized_profile = (
        profile if profile in GeminiAdapter.LIVE_SPEECH_PROFILES else None
    )
    try:
        token_data = await adapter.generate_ephemeral_token(
            ttl_seconds=ttl, profile=normalized_profile
        )
        return TokenResponse(
            token=token_data["token"],
            expiresAt=token_data["expiresAt"],
            model=token_data["model"],
        )
    except Exception:
        # Fail closed: never echo adapter errors because SDK messages could
        # contain credential-like values. The frontend only needs a safe failure.
        raise HTTPException(
            status_code=503,
            detail="Gemini Live secure connection unavailable; please try again later",
        )
