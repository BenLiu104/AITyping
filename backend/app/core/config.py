import os
from typing import List, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Gemini API 金鑰
    GEMINI_API_KEY: str = "your_gemini_api_key_here"

    # Model 設定 (預設使用 Ben 指定的名)
    GEMINI_LIVE_MODEL: str = "models/gemini-3.1-flash-live-preview"
    GEMINI_CLEANUP_MODEL: str = "gemini-3.1-flash-lite"

    # 伺服器設定
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000

    # CORS 跨域設定（生產 domain 由 .env 的 ALLOWED_ORIGINS 提供；此處只留 local dev 預設）
    ALLOWED_ORIGINS: Union[str, List[str]] = [
        "http://localhost:5173",
        "http://localhost:4173",
    ]

    # 開發輔助
    MOCK_MODE: bool = False
    LIVE_TOKEN_TTL: int = 600

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v) -> List[str]:
        if isinstance(v, str):
            # 如果 .env 傳入的是像 ["http://foo"] 這種 JSON 字串，先嘗試解析，不然就逗號分割
            import json

            v_stripped = v.strip()
            if v_stripped.startswith("[") and v_stripped.endswith("]"):
                try:
                    return json.loads(v_stripped)
                except Exception:
                    pass
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    # 專案結構: backend/app/core/config.py，所以根目錄在 ../../../
    model_config = SettingsConfigDict(
        env_file=os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..", ".env")
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
