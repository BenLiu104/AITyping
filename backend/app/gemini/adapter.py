import json
import re
import datetime
from typing import Optional
from google import genai
from google.genai import types
from google.genai.errors import APIError
from app.core.config import settings


class GeminiAdapter:
    """Gemini 官方 `google-genai` SDK 的封裝與適配層

    將 Live API 模型、Cleanup 模型集中化，並處理 Mock 模式的切換。
    """

    SMART_CLEANUP_INTENT_STATUSES = {
        "decided",
        "leaning",
        "comparing",
        "uncertain",
        "note",
    }

    def __init__(self, api_key: Optional[str] = None, mock_mode: Optional[bool] = None):
        self.mock_mode = mock_mode if mock_mode is not None else settings.MOCK_MODE
        self.api_key = api_key or settings.GEMINI_API_KEY

        # 除非是 mock_mode 且無 API key，否則初始化 client
        if not self.mock_mode:
            if not self.api_key or self.api_key == "your_gemini_api_key_here":
                raise ValueError(
                    "無法初始化 Gemini Client：API Key 缺失。請於 .env 設定 GEMINI_API_KEY。"
                )
            self.client = genai.Client(api_key=self.api_key)
        else:
            self.client = None

    def get_live_model_name(self) -> str:
        """獲取 WebSocket Live API 模型名稱"""
        return settings.GEMINI_LIVE_MODEL

    def get_cleanup_model_name(self) -> str:
        """獲取文字整理（Cleanup）模型名稱"""
        return settings.GEMINI_CLEANUP_MODEL

    def _resolve_live_token_ttl(self, ttl_seconds: Optional[int] = None) -> int:
        raw_ttl = settings.LIVE_TOKEN_TTL if ttl_seconds is None else ttl_seconds
        try:
            ttl = int(raw_ttl)
        except (TypeError, ValueError) as e:
            raise ValueError("LIVE_TOKEN_TTL must be a positive integer") from e

        if ttl <= 0:
            raise ValueError("LIVE_TOKEN_TTL must be a positive integer")

        return min(ttl, 1800)

    async def generate_ephemeral_token(self, ttl_seconds: Optional[int] = None) -> dict:
        """為 Live API WebSocket 連線簽發短效 ephemeral token

        非 mock 模式只回傳 Gemini Live ephemeral token；若簽發失敗必須 fail closed，
        絕不可把長效 GEMINI_API_KEY 當作 token 回傳給前端。
        """
        expire_seconds = self._resolve_live_token_ttl(ttl_seconds)

        if self.mock_mode:
            now = datetime.datetime.now(datetime.timezone.utc)
            return {
                "token": "mock_ephemeral_token_xyz123",
                "expiresAt": (
                    now + datetime.timedelta(seconds=expire_seconds)
                ).isoformat(),
                "model": self.get_live_model_name(),
            }

        if not self.api_key or self.api_key == "your_gemini_api_key_here":
            raise ValueError(
                "GEMINI_API_KEY is missing; cannot create Gemini Live ephemeral token"
            )

        now = datetime.datetime.now(datetime.timezone.utc)
        expire_time = now + datetime.timedelta(seconds=expire_seconds)
        new_session_expire_time = now + datetime.timedelta(minutes=1)

        try:
            token_client = genai.Client(
                api_key=self.api_key,
                http_options={"api_version": "v1alpha"},
            )
            token = token_client.auth_tokens.create(
                config={
                    "uses": 1,
                    "expire_time": expire_time,
                    "new_session_expire_time": new_session_expire_time,
                    "live_connect_constraints": {
                        "model": self.get_live_model_name(),
                    },
                    "http_options": {"api_version": "v1alpha"},
                }
            )
        except Exception as e:
            message = str(e).replace(self.api_key, "[REDACTED]")
            raise RuntimeError(
                f"Gemini Live ephemeral token creation failed: {message}"
            ) from e

        return {
            "token": token.name,
            "expiresAt": expire_time.isoformat(),
            "model": self.get_live_model_name(),
        }

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
            "prompt": "模式：AI Prompt。請將用戶雜亂的想法整理成一段具體、清晰、邏輯分明、可直接拿來餵給 AI（例如 ChatGPT/Claude）的優質 Prompt。",
        }

        # 針對不同語言的提示
        language_prompts = {
            "zh-Hant": "語言：繁體中文。請確保輸出完全為流暢的繁體中文（台灣/香港常用用語）。",
            "en": "語言：英文。請確保輸出完全為流暢專業的英文。",
            "mixed": "語言：Cantonese-English mixed speech。原始聽寫可能含有 Cantonese ASR 錯字。請修復最可能的粵英夾雜語音輸入，使用香港繁體中文表達 Cantonese，Preserve English words, product names, app names, and technical terms in English，不要把英文翻成中文，不要把 Cantonese 改成普通話式中文。",
            "yue": "語言：Cantonese。原始聽寫可能含有 Cantonese ASR 錯字。用戶口述的是香港廣東話，請在保留原意與語氣的前提下，使用香港繁體中文整理；可修正明顯聽寫錯字，但不要新增內容。",
        }

        user_content = (
            f"{mode_prompts.get(mode, mode_prompts['message'])}\n"
            f"{language_prompts.get(language, language_prompts['mixed'])}\n\n"
            f"原始聽寫文字如下：\n"
            f'"""\n{raw_transcript}\n"""'
        )

        try:
            response = self.client.models.generate_content(
                model=self.get_cleanup_model_name(),
                contents=user_content,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.2,  # 降低隨機性，保證準確
                ),
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

    async def smart_cleanup(
        self, transcript: str, language_mode: str = "mixed"
    ) -> dict:
        """MVP1 Smart Cleanup：對「最終逐字稿」做語義層整理，推斷用戶最終真正想講嘅意思

        只喺 stop 錄音、final transcript 已經齊全之後先呼叫一次；唔處理 interim transcript。
        - transcript: 完整最終逐字稿（raw，未經 /api/cleanup 處理）
        - language_mode: yue (粵語), mixed (中英混合), en (英文), zh-Hant (繁體中文)

        回傳 dict：{ clean_text, intent_status, reasoning_summary, confidence }
        """
        if self.mock_mode:
            return {
                "clean_text": f"[Mock Smart Cleanup ({language_mode})]: {transcript.strip()}",
                "intent_status": "decided",
                "reasoning_summary": "Mock 模式：未實際呼叫 Gemini，直接回傳原文包裝結果。",
                "confidence": 0.5,
            }

        if not transcript.strip():
            # 與 cleanup_transcript 對齊：空白輸入靜默回傳空結果，不呼叫模型。
            return {
                "clean_text": "",
                "intent_status": "note",
                "reasoning_summary": "",
                "confidence": 0.0,
            }

        if self.client is None:
            raise ValueError("Client 未初始化，無法呼叫 API。")

        system_instruction = (
            "You are a semantic cleanup engine for live speech transcripts.\n\n"
            "Your job is to infer the user's current intended meaning from the full final transcript.\n\n"
            "The transcript may contain:\n"
            "- hesitations\n"
            "- filler words\n"
            "- repeated words\n"
            "- self-corrections\n"
            "- abandoned ideas\n"
            "- changed decisions\n"
            "- mixed Cantonese, Chinese, and English\n"
            "- imperfect speech-to-text errors\n\n"
            "Do not simply correct grammar.\n"
            "Do not preserve abandoned thoughts unless they are needed to explain the final meaning.\n"
            "Do not invent facts that are not supported by the transcript.\n"
            "If the user clearly changes their mind, follow the latest decision.\n"
            "If the user is still undecided, preserve that uncertainty.\n"
            "Output concise, natural Traditional Chinese by default unless the transcript is clearly English.\n"
            "Return JSON only."
        )

        user_content = (
            f'languageMode: {language_mode}\n\n完整最終逐字稿：\n"""\n{transcript}\n"""'
        )

        response_schema = {
            "type": "object",
            "properties": {
                "clean_text": {"type": "string"},
                "intent_status": {
                    "type": "string",
                    "enum": sorted(self.SMART_CLEANUP_INTENT_STATUSES),
                },
                "reasoning_summary": {"type": "string"},
                "confidence": {"type": "number"},
            },
            "required": [
                "clean_text",
                "intent_status",
                "reasoning_summary",
                "confidence",
            ],
        }

        try:
            response = self.client.models.generate_content(
                model=self.get_cleanup_model_name(),
                contents=user_content,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.2,
                    response_mime_type="application/json",
                    response_schema=response_schema,
                ),
            )

            raw_result = response.text
            if not raw_result or not raw_result.strip():
                raise RuntimeError("Gemini 回傳空白內容，無法解析 Smart Cleanup 結果。")

            return self._parse_smart_cleanup_response(raw_result)

        except APIError as e:
            raise RuntimeError(f"Gemini API Smart Cleanup 呼叫失敗: {e}")

    def _parse_smart_cleanup_response(self, raw_result: str) -> dict:
        """解析 Gemini 回傳嘅 Smart Cleanup JSON；解析失敗時嘗試搶救 clean_text。"""
        text = raw_result.strip()
        # 防範模型頑固地返回 ``` 包裹（與 cleanup_transcript 對齊的處理方式）
        if text.startswith("```") and text.endswith("```"):
            lines = text.split("\n")
            if len(lines) >= 3:
                text = "\n".join(lines[1:-1]).strip()

        try:
            data = json.loads(text)
            clean_text = str(data.get("clean_text", "")).strip()
            if not clean_text:
                raise ValueError("Smart Cleanup JSON 缺少 clean_text。")

            intent_status = data.get("intent_status", "note")
            if intent_status not in self.SMART_CLEANUP_INTENT_STATUSES:
                intent_status = "note"

            reasoning_summary = str(data.get("reasoning_summary") or "")

            try:
                confidence = float(data.get("confidence", 0.0))
            except (TypeError, ValueError):
                confidence = 0.0

            return {
                "clean_text": clean_text,
                "intent_status": intent_status,
                "reasoning_summary": reasoning_summary,
                "confidence": confidence,
            }
        except (json.JSONDecodeError, ValueError):
            pass

        # JSON 解析失敗或缺 clean_text：嘗試搶救 clean_text（PRD 要求：try to recover if possible）
        match = re.search(r'"clean_text"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
        if match:
            try:
                recovered = json.loads(f'"{match.group(1)}"')
            except json.JSONDecodeError:
                recovered = match.group(1)
            if recovered.strip():
                return {
                    "clean_text": recovered.strip(),
                    "intent_status": "note",
                    "reasoning_summary": "",
                    "confidence": 0.0,
                }

        raise RuntimeError(
            "Smart Cleanup 回傳內容無法解析為 JSON，且無法搶救 clean_text。"
        )
