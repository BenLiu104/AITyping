import pytest
from app.gemini.adapter import GeminiAdapter


@pytest.mark.asyncio
async def test_gemini_adapter_mock_mode():
    # 測試 Mock 模式下的行為
    adapter = GeminiAdapter(mock_mode=True)

    assert adapter.get_live_model_name() == "models/gemini-3.1-flash-live-preview"
    assert adapter.get_cleanup_model_name() == "gemini-3.1-flash-lite"

    # 測試 Mock Token
    token_res = await adapter.generate_ephemeral_token()
    assert token_res["token"] == "mock_ephemeral_token_xyz123"
    assert "expiresAt" in token_res
    assert token_res["model"] == "models/gemini-3.1-flash-live-preview"

    # 測試 Mock Cleanup
    cleanup_res = await adapter.cleanup_transcript(
        "hello world", mode="message", language="en"
    )
    assert "Mock Cleaned (message-en)" in cleanup_res
    assert "HELLO WORLD" in cleanup_res


@pytest.mark.asyncio
async def test_generate_ephemeral_token_uses_auth_tokens_create(monkeypatch):
    captured = {}

    class FakeAuthTokens:
        def create(self, *, config):
            captured["config"] = config

            class Token:
                name = "auth_tokens/test-ephemeral-token"

            return Token()

    class FakeClient:
        def __init__(self, *, api_key, http_options):
            captured["api_key"] = api_key
            captured["http_options"] = http_options
            self.auth_tokens = FakeAuthTokens()

    monkeypatch.setattr("app.gemini.adapter.genai.Client", FakeClient)

    adapter = GeminiAdapter(api_key="real-backend-api-key", mock_mode=True)
    adapter.mock_mode = False

    result = await adapter.generate_ephemeral_token(ttl_seconds=3600, profile="english")

    assert result["token"] == "auth_tokens/test-ephemeral-token"
    assert result["token"] != "real-backend-api-key"
    assert result["model"] == "models/gemini-3.1-flash-live-preview"
    assert captured["api_key"] == "real-backend-api-key"
    assert captured["http_options"] == {"api_version": "v1alpha"}
    assert captured["config"]["uses"] == 1
    assert captured["config"]["http_options"] == {"api_version": "v1alpha"}
    # Constrained endpoint ignores client-sent setup, so model + full setup
    # (responseModalities / inputAudioTranscription / systemInstruction) must be
    # locked into the token at mint time.
    constraints = captured["config"]["live_connect_constraints"]
    assert constraints["model"] == "models/gemini-3.1-flash-live-preview"
    cfg = constraints["config"]
    assert cfg["responseModalities"] == ["AUDIO"]
    assert cfg["inputAudioTranscription"] == {}
    instruction = cfg["systemInstruction"]["parts"][0]["text"]
    assert "Transcribe" in instruction
    # english profile hint locked into the token's system instruction
    assert "The user speaks English" in instruction


@pytest.mark.parametrize(
    "profile,expected_snippets,absent_snippets",
    [
        (
            "cantonese-english",
            ["Cantonese-English", "Hong Kong Cantonese", "Never output Japanese"],
            ["Yue"],
        ),
        (
            "cantonese",
            ["The user speaks Hong Kong Cantonese", "Never output Japanese"],
            ["Yue"],
        ),
        ("english", ["The user speaks English"], []),
        # Unknown / auto profiles fall back to the base verbatim instruction only.
        ("auto", ["Transcribe"], ["Hong Kong", "The user speaks English"]),
        (None, ["Transcribe"], ["Hong Kong", "The user speaks English"]),
    ],
)
def test_build_transcription_instruction_by_profile(
    profile, expected_snippets, absent_snippets
):
    adapter = GeminiAdapter(mock_mode=True)
    instruction = adapter._build_transcription_instruction(profile)
    for snippet in expected_snippets:
        assert snippet in instruction
    for snippet in absent_snippets:
        assert snippet not in instruction


@pytest.mark.asyncio
@pytest.mark.parametrize("ttl_seconds", [-60, 0])
async def test_generate_ephemeral_token_rejects_non_positive_ttl(
    ttl_seconds, monkeypatch
):
    class FakeClient:
        def __init__(self, *, api_key, http_options):
            raise AssertionError("invalid ttl must be rejected before SDK call")

    monkeypatch.setattr("app.gemini.adapter.genai.Client", FakeClient)

    adapter = GeminiAdapter(api_key="real-backend-api-key", mock_mode=True)
    adapter.mock_mode = False

    with pytest.raises(ValueError) as excinfo:
        await adapter.generate_ephemeral_token(ttl_seconds=ttl_seconds)

    assert "positive integer" in str(excinfo.value)


@pytest.mark.asyncio
async def test_generate_ephemeral_token_failure_never_returns_api_key(monkeypatch):
    class FakeClient:
        def __init__(self, *, api_key, http_options):
            self.auth_tokens = self

        def create(self, *, config):
            raise RuntimeError("upstream rejected real-backend-api-key")

    monkeypatch.setattr("app.gemini.adapter.genai.Client", FakeClient)

    adapter = GeminiAdapter(api_key="real-backend-api-key", mock_mode=True)
    adapter.mock_mode = False

    with pytest.raises(RuntimeError) as excinfo:
        await adapter.generate_ephemeral_token()

    assert "real-backend-api-key" not in str(excinfo.value)
    assert "[REDACTED]" in str(excinfo.value)


@pytest.mark.asyncio
async def test_cleanup_prompt_repairs_cantonese_english_asr_without_yue_label():
    captured = {}

    class FakeModels:
        def generate_content(self, *, model, contents, config):
            captured["model"] = model
            captured["contents"] = contents
            captured["config"] = config

            class Response:
                text = "整理後文字"

            return Response()

    class FakeClient:
        models = FakeModels()

    adapter = GeminiAdapter(mock_mode=True)
    adapter.mock_mode = False
    adapter.client = FakeClient()

    result = await adapter.cleanup_transcript(
        "check 下 Docker compose 個 backend service 係咪 running",
        mode="message",
        language="mixed",
    )

    assert result == "整理後文字"
    assert "Cantonese-English" in captured["contents"]
    assert "Cantonese ASR" in captured["contents"]
    assert "Preserve English" in captured["contents"]
    assert "Yue" not in captured["contents"]


def test_gemini_adapter_no_api_key_validation():
    # 測試無 API key 時，在非 Mock 模式下拋出 ValueError
    with pytest.raises(ValueError) as excinfo:
        GeminiAdapter(api_key="your_gemini_api_key_here", mock_mode=False)
    assert "API Key 缺失" in str(excinfo.value)


@pytest.mark.asyncio
async def test_smart_cleanup_mock_mode():
    adapter = GeminiAdapter(mock_mode=True)

    result = await adapter.smart_cleanup("hello world", language_mode="en")

    assert "Mock Smart Cleanup (en)" in result["clean_text"]
    assert "hello world" in result["clean_text"]
    assert result["intent_status"] == "decided"
    assert result["confidence"] == 0.5


@pytest.mark.asyncio
async def test_smart_cleanup_empty_transcript_does_not_call_model():
    called = {"count": 0}

    class FakeModels:
        def generate_content(self, *, model, contents, config):
            called["count"] += 1
            raise AssertionError("empty transcript must not call the model")

    class FakeClient:
        models = FakeModels()

    adapter = GeminiAdapter(mock_mode=True)
    adapter.mock_mode = False
    adapter.client = FakeClient()

    result = await adapter.smart_cleanup("   ", language_mode="mixed")

    assert called["count"] == 0
    assert result["clean_text"] == ""


@pytest.mark.asyncio
async def test_smart_cleanup_parses_structured_json_response():
    captured = {}

    class FakeModels:
        def generate_content(self, *, model, contents, config):
            captured["model"] = model
            captured["contents"] = contents
            captured["config"] = config

            class Response:
                text = (
                    '{"clean_text": "今晚因性價比關係會食菜心。", '
                    '"intent_status": "decided", '
                    '"reasoning_summary": "使用者從生菜改回菜心。", '
                    '"confidence": 0.91}'
                )

            return Response()

    class FakeClient:
        models = FakeModels()

    adapter = GeminiAdapter(mock_mode=True)
    adapter.mock_mode = False
    adapter.client = FakeClient()

    result = await adapter.smart_cleanup(
        "我今晚想食菜心，um，都係唔好，今日生菜比較靚。但生菜好貴，都係菜心性價比高啲。",
        language_mode="yue",
    )

    assert result["clean_text"] == "今晚因性價比關係會食菜心。"
    assert result["intent_status"] == "decided"
    assert result["confidence"] == 0.91
    assert captured["config"].response_mime_type == "application/json"
    assert "languageMode: yue" in captured["contents"]


@pytest.mark.asyncio
async def test_smart_cleanup_invalid_intent_status_falls_back_to_note():
    class FakeModels:
        def generate_content(self, *, model, contents, config):
            class Response:
                text = (
                    '{"clean_text": "整理後文字", '
                    '"intent_status": "not_a_real_status", '
                    '"reasoning_summary": "", '
                    '"confidence": 0.4}'
                )

            return Response()

    class FakeClient:
        models = FakeModels()

    adapter = GeminiAdapter(mock_mode=True)
    adapter.mock_mode = False
    adapter.client = FakeClient()

    result = await adapter.smart_cleanup("test", language_mode="en")

    assert result["clean_text"] == "整理後文字"
    assert result["intent_status"] == "note"


@pytest.mark.asyncio
async def test_smart_cleanup_recovers_clean_text_from_malformed_json():
    class FakeModels:
        def generate_content(self, *, model, contents, config):
            class Response:
                # 刻意輸出壞掉嘅 JSON（結尾缺 }），但 clean_text 欄位仍可用 regex 搶救
                text = '{"clean_text": "搶救回嚟嘅文字", "intent_status": "decided"'

            return Response()

    class FakeClient:
        models = FakeModels()

    adapter = GeminiAdapter(mock_mode=True)
    adapter.mock_mode = False
    adapter.client = FakeClient()

    result = await adapter.smart_cleanup("test", language_mode="mixed")

    assert result["clean_text"] == "搶救回嚟嘅文字"
    assert result["intent_status"] == "note"


@pytest.mark.asyncio
async def test_smart_cleanup_raises_when_completely_unparseable():
    class FakeModels:
        def generate_content(self, *, model, contents, config):
            class Response:
                text = "completely not json and no clean_text field at all"

            return Response()

    class FakeClient:
        models = FakeModels()

    adapter = GeminiAdapter(mock_mode=True)
    adapter.mock_mode = False
    adapter.client = FakeClient()

    with pytest.raises(RuntimeError) as excinfo:
        await adapter.smart_cleanup("test", language_mode="mixed")
    assert "無法解析" in str(excinfo.value)
