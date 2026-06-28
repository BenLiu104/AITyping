from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional
from app.gemini.adapter import GeminiAdapter

router = APIRouter()


def get_gemini_adapter() -> GeminiAdapter:
    return GeminiAdapter()


class TokenResponse(BaseModel):
    token: str = Field(..., description="Gemini Live API ephemeral token (短效 Token)")
    expiresAt: str = Field(..., alias="expiresAt", description="Token 失效時間 (ISO-8601 格式)")
    model: str = Field(..., description="對應的 Live API WebSocket 模型名稱")

    model_config = {
        "populate_by_name": True,
        "json_schema_extra": {
            "example": {
                "token": "mock_ephemeral_token_xyz123",
                "expiresAt": "2026-06-27T12:00:00Z",
                "model": "models/gemini-3.1-flash-live-preview"
            }
        }
    }


@router.post("/live-token", response_model=TokenResponse, tags=["Gemini"])
async def get_live_token(
    ttl: Optional[int] = None,
    adapter: GeminiAdapter = Depends(get_gemini_adapter),
):
    """簽發用於前端瀏覽器直連 Gemini Live API WebSocket 的短效 Ephemeral Token"""
    try:
        token_data = await adapter.generate_ephemeral_token(ttl_seconds=ttl)
        return TokenResponse(
            token=token_data["token"],
            expiresAt=token_data["expiresAt"],
            model=token_data["model"]
        )
    except NotImplementedError as e:
        # 當 SDK 還不支援真實 token 簽發時，如果正處於非 Mock，給予 501
        raise HTTPException(
            status_code=501,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"簽署 Ephemeral Token 失敗: {str(e)}"
        )
