import os
from typing import Optional
from google import genai
from google.genai import types
from google.genai.errors import APIError
from app.core.config import settings


class GeminiAdapter:
    """Gemini 官方 `google-genai` SDK 的封裝與適配層

    將 Live API 模型、Cleanup 模型集中化，並處理 Mock 模式的切換。
    """

    def __init__(self, api_key: Optional[str] = None, mock_mode: Optional[bool] = None):
        self.mock_mode = mock_mode if mock_mode is not None else settings.MOCK_MODE
        self.api_key = api_key or settings.GEMINI_API_KEY

        # 除非是 mock_mode 且無 API key，否則初始化 client
        if not self.mock_mode:
            if not self.api_key or self.api_key == "your_gemini_api_key_here":
                raise ValueError("無法初始化 Gemini Client：API Key 缺失。請於 .env 設定 GEMINI_API_KEY。")
            self.client = genai.Client(api_key=self.api_key)
        else:
            self.client = None

    def get_live_model_name(self) -> str:
        """獲取 WebSocket Live API 模型名稱"""
        return settings.GEMINI_LIVE_MODEL

    def get_cleanup_model_name(self) -> str:
        """獲取文字整理（Cleanup）模型名稱"""
        return settings.GEMINI_CLEANUP_MODEL

    async def generate_ephemeral_token(self, ttl_seconds: Optional[int] = None) -> dict:
        """為 Live API WebSocket 連線簽發短效 ephemeral token

        NOTE:
        根據 google-genai 1.x SDK 設計，透過 client.models.generate_web_token() 或類似機制簽發 Token。
        若處於 Mock 模式，則回傳模擬 Token。
        """
        ttl = ttl_seconds or settings.LIVE_TOKEN_TTL
        
        if self.mock_mode:
            import datetime
            return {
                "token": "mock_ephemeral_token_xyz123",
                "expiresAt": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=ttl)).isoformat(),
                "model": self.get_live_model_name()
            }

        if self.client is None:
            raise ValueError("Client 未初始化，無法呼叫 API。")

        try:
            # 官方 Live Client/WebSocket Token 簽發方式：
            # 為了防範 API 變更，我們用 adapter 做這層包裝
            # 在 Live API 1.0 中，最通用的簽署方式是：
            try:
                # 這裡我們先封裝標準呼叫。
                response = self.client.models.create_web_token(
                    model=self.get_live_model_name(),
                    ttl=f"{ttl}s"
                )
                return {
                    "token": response.token,
                    "expiresAt": response.expires_at,
                    "model": self.get_live_model_name()
                }
            except AttributeError:
                # 降級處理：如果 google-genai 新版 client.models 還未發布 create_web_token 方法，
                # 我們可以藉由返回 API Key（或將其包裝為臨時 Token）作為回退。
                raise NotImplementedError("google-genai SDK 版本尚未完整支援 ephemeral token 簽發，請確認 SDK 版本或暫用 Mock 模式。")

        except APIError as e:
            raise RuntimeError(f"Gemini API 簽署 ephemeral token 失敗: {e}")

    async def cleanup_transcript(
        self, raw_transcript: str, mode: str = "message", language: str = "mixed"
    ) -> str:
        """呼叫 gemini-3.1-flash-lite 進行文字整理與優化

        - raw_transcript: 語音聽寫出來的原始文字
        - mode: message (聊天), email (電子郵件), todo (工作項目), prompt (AI Prompt)
        - language: zh-Hant (繁體中文), en (英文), mixed (中英混合), yue (粵語口語轉書面)
        """
        if self.mock_mode:
            # 模擬整理後的回應
            return f"[Mock Cleaned ({mode}-{language})]: {raw_transcript.upper()}"

        if not raw_transcript.strip():
            return ""

        if self.client is None:
            raise ValueError("Client 未初始化，無法呼叫 API。")

        # 構建 Prompt
        system_instruction = (
            "你是語音輸入文字整理器。\n"
            "1. 保留原意，不要加新資訊。\n"
            "2. 修正聽寫錯字。\n"
            "3. 移除停頓詞（呃、嗯、就是、這個那個）。\n"
            "4. 補上自然標點。\n"
            "5. 保留用戶說話時的語氣偏好。\n"
            "6. 只輸出整理後的最終文字，不要有任何多餘的解釋、標籤、Markdown Code Block（除非是程式碼模式）。\n"
        )

        # 針對不同 mode 的提示
        mode_prompts = {
            "message": "模式：社群聊天/訊息。請使用口語化、自然簡潔的文字，就像一般在 WhatsApp/Telegram 聊天一樣。",
            "email": "模式：電子郵件。請使用禮貌、客氣、結構清楚且專業的書面商業格式與語氣。",
            "todo": "模式：待辦清單/TODO。請整理成以動詞或清晰動作開頭的待辦條目，使用「- [ ]」列表格式。",
            "prompt": "模式：AI Prompt。請將用戶雜亂的想法整理成一段具體、清晰、邏輯分明、可直接拿來餵給 AI（例如 ChatGPT/Claude）的優質 Prompt。"
        }

        # 針對不同語言的提示
        language_prompts = {
            "zh-Hant": "語言：繁體中文。請確保輸出完全為流暢的繁體中文（台灣/香港常用用語）。",
            "en": "語言：英文。請確保輸出完全為流暢專業的英文。",
            "mixed": "語言：中英混合。請保留原本自然的「中英混合」夾雜特點，不要強行翻譯專有名詞（如 iPhone、meeting、App 等），確保半形空格與前後中文相接自然。",
            "yue": "語言：粵語轉書面。用戶口述的是廣東話/粵語，請在保留原意與語氣的前提下，將其「粵語口語」翻譯並整理成得體、通順的「繁體中文書面語」（將「唔好」轉為「不要」、「佢哋」轉為「他們」等）。"
        }

        user_content = (
            f"{mode_prompts.get(mode, mode_prompts['message'])}\n"
            f"{language_prompts.get(language, language_prompts['mixed'])}\n\n"
            f"原始聽寫文字如下：\n"
            f"\"\"\"\n{raw_transcript}\n\"\"\""
        )

        try:
            response = self.client.models.generate_content(
                model=self.get_cleanup_model_name(),
                contents=user_content,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.2, # 降低隨機性，保證準確
                )
            )
            
            # 確保獲取 response.text 並且其不為 None
            raw_result = response.text
            if not raw_result:
                return ""
                
            cleaned_text = raw_result.strip()
            # 防範模型頑固地返回 ``` 包裹
            if cleaned_text.startswith("```") and cleaned_text.endswith("```"):
                # 剝除首尾 Code Block
                lines = cleaned_text.split("\n")
                if len(lines) >= 3:
                    cleaned_text = "\n".join(lines[1:-1]).strip()
            
            return cleaned_text

        except APIError as e:
            raise RuntimeError(f"Gemini API 整理文字失敗: {e}")
