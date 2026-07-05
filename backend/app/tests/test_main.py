from fastapi.testclient import TestClient
from app.main import app
from app.gemini.adapter import GeminiAdapter

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "mock_mode" in data
    assert "live_model" in data
    assert "cleanup_model" in data


# 建立一個測試用的強制 Mock 模式注入
def get_mock_gemini_adapter():
    return GeminiAdapter(mock_mode=True)


def test_cleanup_route_mock():
    from app.routes.cleanup import get_gemini_adapter as cleanup_adapter
    from app.routes.token import get_gemini_adapter as token_adapter

    app.dependency_overrides[cleanup_adapter] = get_mock_gemini_adapter
    app.dependency_overrides[token_adapter] = get_mock_gemini_adapter

    payload = {
        "rawTranscript": "hello testing routing",
        "mode": "message",
        "language": "en",
    }
    response = client.post("/api/cleanup", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "cleaned" in data
    assert data["mode"] == "message"
    assert "[Mock Cleaned (message-en)]" in data["cleaned"]

    app.dependency_overrides.clear()


def test_cleanup_route_validation():
    from app.routes.cleanup import get_gemini_adapter as cleanup_adapter

    # 這裡也要 override，因為 validation 雖然在 Pydantic 就擋掉 422，但 FastAPI 會先 resolve Depends 依賴！
    app.dependency_overrides[cleanup_adapter] = get_mock_gemini_adapter

    # 測試必填欄位缺失
    payload = {"mode": "message"}
    response = client.post("/api/cleanup", json=payload)
    assert response.status_code == 422

    app.dependency_overrides.clear()


def test_live_token_route_mock():
    from app.routes.token import get_gemini_adapter as token_adapter

    app.dependency_overrides[token_adapter] = get_mock_gemini_adapter

    response = client.post("/api/live-token")
    assert response.status_code == 200
    data = response.json()
    assert data["token"] == "mock_ephemeral_token_xyz123"
    assert "expiresAt" in data
    assert data["model"] == "models/gemini-3.1-flash-live-preview"

    app.dependency_overrides.clear()


def test_debug_event_accepts_counters_without_content():
    payload = {
        "phase": "no-transcript",
        "build": "v02:31",
        "wsOpen": True,
        "setupComplete": True,
        "audioChunks": 42,
        "audioBytes": 2048,
        "audioSent": 40,
        "transcriptEvents": 0,
        "lastCloseCode": 1000,
        "lastCloseReason": "",
        "lastError": "",
    }
    response = client.post("/api/debug-event", json=payload)
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_debug_event_rejects_transcript_field():
    payload = {
        "phase": "no-transcript",
        "build": "v02:31",
        "rawTranscript": "should never be accepted",
    }
    response = client.post("/api/debug-event", json=payload)
    assert response.status_code == 422


def test_smart_cleanup_route_mock():
    from app.routes.smart_cleanup import get_gemini_adapter as smart_cleanup_adapter

    app.dependency_overrides[smart_cleanup_adapter] = get_mock_gemini_adapter

    payload = {
        "transcript": "我今晚想食菜心，um，都係唔好，今日生菜比較靚。但生菜好貴，都係菜心性價比高啲。",
        "languageMode": "yue",
    }
    response = client.post("/api/smart-cleanup", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "Mock Smart Cleanup (yue)" in data["clean_text"]
    assert data["intent_status"] == "decided"
    assert "confidence" in data

    app.dependency_overrides.clear()


def test_smart_cleanup_route_validation_rejects_empty_transcript():
    from app.routes.smart_cleanup import get_gemini_adapter as smart_cleanup_adapter

    app.dependency_overrides[smart_cleanup_adapter] = get_mock_gemini_adapter

    payload = {"transcript": "", "languageMode": "mixed"}
    response = client.post("/api/smart-cleanup", json=payload)
    assert response.status_code == 422

    app.dependency_overrides.clear()


def test_smart_cleanup_route_validation_requires_transcript_field():
    from app.routes.smart_cleanup import get_gemini_adapter as smart_cleanup_adapter

    app.dependency_overrides[smart_cleanup_adapter] = get_mock_gemini_adapter

    payload = {"languageMode": "mixed"}
    response = client.post("/api/smart-cleanup", json=payload)
    assert response.status_code == 422

    app.dependency_overrides.clear()
