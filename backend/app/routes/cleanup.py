from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Literal
from app.gemini.adapter import GeminiAdapter

router = APIRouter()


# 依賴注入：獲取 GeminiAdapter 實例
def get_gemini_adapter() -> GeminiAdapter:
    return GeminiAdapter()


class CleanupRequest(BaseModel):
    rawTranscript: str = Field(
        ...,
        alias="rawTranscript",
        description="語音聽寫出來的原始文字",
        min_length=1,
    )
    mode: Literal["message", "email", "todo", "prompt"] = Field(
        default="message",
        description="優化整理模式：message (聊天), email (郵件), todo (待辦), prompt (AI Prompt)",
    )
    language: Literal["zh-Hant", "en", "mixed", "yue"] = Field(
        default="mixed",
        description="語言模式偏好：zh-Hant (繁體中文), en (英文), mixed (中英混合), yue (粵語)",
    )
    style: str = Field(
        default="natural",
        description="整理風格偏好，預設為 natural (自然)",
    )

    model_config = {
        "populate_by_name": True,
        "json_schema_extra": {
            "example": {
                "rawTranscript": "呃就是我們今天下晝三點開個會啊記住要 deal 埋個 client 嘅問題",
                "mode": "message",
                "language": "yue",
                "style": "natural",
            }
        },
    }


class CleanupResponse(BaseModel):
    cleaned: str = Field(..., description="整理優化後的乾淨文字")
    mode: str = Field(..., description="所使用的整理模式")


@router.post("/cleanup", response_model=CleanupResponse, tags=["Gemini"])
async def cleanup_transcript_route(
    payload: CleanupRequest,
    adapter: GeminiAdapter = Depends(get_gemini_adapter),
):
    """將雜亂的語音原始轉寫文字 (Raw Transcript) 進行清理、標點修正與風格整理"""
    try:
        cleaned_text = await adapter.cleanup_transcript(
            raw_transcript=payload.rawTranscript,
            mode=payload.mode,
            language=payload.language,
        )
        return CleanupResponse(cleaned=cleaned_text, mode=payload.mode)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"文字優化整理失敗: {str(e)}"
        )
