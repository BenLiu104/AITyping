from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Literal
from app.gemini.adapter import GeminiAdapter

router = APIRouter()


# 依賴注入：獲取 GeminiAdapter 實例
def get_gemini_adapter() -> GeminiAdapter:
    return GeminiAdapter()


class SmartCleanupRequest(BaseModel):
    transcript: str = Field(
        ...,
        description="停止錄音後嘅完整最終逐字稿（raw transcript）",
        min_length=1,
    )
    languageMode: Literal["zh-Hant", "en", "mixed", "yue"] = Field(
        default="mixed",
        alias="languageMode",
        description="語言模式偏好：zh-Hant (繁體中文), en (英文), mixed (中英混合), yue (粵語)",
    )

    model_config = {
        "populate_by_name": True,
        "json_schema_extra": {
            "example": {
                "transcript": "我今晚想食菜心，um，都係唔好，今日生菜比較靚。但生菜好貴，都係菜心性價比高啲。",
                "languageMode": "yue",
            }
        },
    }


class SmartCleanupResponse(BaseModel):
    clean_text: str = Field(..., description="推斷用戶最終意思後嘅語義整理結果")
    intent_status: str = Field(
        ..., description="decided | leaning | comparing | uncertain | note"
    )
    reasoning_summary: str = Field(
        default="", description="推理摘要，供 debug/未來使用"
    )
    confidence: float = Field(
        default=0.0, description="模型信心分數，供 debug/未來使用"
    )


@router.post("/smart-cleanup", response_model=SmartCleanupResponse, tags=["Gemini"])
async def smart_cleanup_route(
    payload: SmartCleanupRequest,
    adapter: GeminiAdapter = Depends(get_gemini_adapter),
):
    """MVP1 Smart Cleanup：對已停止錄音嘅最終逐字稿做語義層整理（非純文法修正）"""
    try:
        result = await adapter.smart_cleanup(
            transcript=payload.transcript,
            language_mode=payload.languageMode,
        )
        return SmartCleanupResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Smart Cleanup 整理失敗: {str(e)}")
