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
    cleanup_res = await adapter.cleanup_transcript("hello world", mode="message", language="en")
    assert "Mock Cleaned (message-en)" in cleanup_res
    assert "HELLO WORLD" in cleanup_res


def test_gemini_adapter_no_api_key_validation():
    # 測試無 API key 時，在非 Mock 模式下拋出 ValueError
    with pytest.raises(ValueError) as excinfo:
        GeminiAdapter(api_key="your_gemini_api_key_here", mock_mode=False)
    assert "API Key 缺失" in str(excinfo.value)
