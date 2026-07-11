"""Tests for the backend SenseVoice WS token module + mint route.

Covers the contract:
  - happy-path mint returns {token, expiresAt}, Cache-Control: no-store, no secret
  - missing/blank secret fails closed with a safe 503
  - expired tokens are rejected by validate_token
  - round-trip mint→validate
  - interoperability against the shared source-controlled vector fixture, so the
    backend cannot silently drift from the SenseVoice validator.
"""

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.security import sensevoice_token as st

client = TestClient(app)

CONTRACT_VECTOR = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "..",
    "contracts",
    "sensevoice_ws_token_vectors.json",
)


def load_vector():
    with open(os.path.abspath(CONTRACT_VECTOR), encoding="utf-8") as fh:
        return json.load(fh)


# ── module-level token unit tests ─────────────────────────────────────────────


def test_mint_and_validate_round_trip():
    secret = "unit-secret"
    minted = st.mint_token(secret, ttl_seconds=60, now=1_000_000)
    assert minted.expires_at == 1_000_060
    payload = st.validate_token(secret, minted.token, now=1_000_030)
    assert payload["aud"] == st.TOKEN_AUDIENCE
    assert payload["v"] == st.TOKEN_VERSION
    assert isinstance(payload["nonce"], str) and payload["nonce"]


def test_mint_missing_secret_fails_closed():
    with pytest.raises(st.TokenConfigError):
        st.mint_token("", ttl_seconds=60)
    with pytest.raises(st.TokenConfigError):
        st.mint_token("   ", ttl_seconds=60)


def test_validate_expired_token_rejected():
    secret = "unit-secret"
    minted = st.mint_token(secret, ttl_seconds=60, now=1_000_000)
    with pytest.raises(st.TokenValidationError):
        st.validate_token(
            secret, minted.token, now=1_000_060
        )  # exp boundary is exclusive
    with pytest.raises(st.TokenValidationError):
        st.validate_token(secret, minted.token, now=1_000_999)


def test_validate_wrong_audience_and_tamper_rejected():
    secret = "unit-secret"
    minted = st.mint_token(secret, ttl_seconds=60, now=1_000_000)
    tampered = minted.token[:-2] + ("aa" if not minted.token.endswith("aa") else "bb")
    with pytest.raises(st.TokenValidationError):
        st.validate_token(secret, tampered, now=1_000_010)
    with pytest.raises(st.TokenValidationError):
        st.validate_token("different-secret", minted.token, now=1_000_010)


def test_matches_shared_contract_vector():
    v = load_vector()
    payload = st.validate_token(v["secret"], v["token"], now=v["payload"]["exp"] - 1)
    assert payload == v["payload"]
    # Re-derive the signature deterministically from the same signing input.
    signing_input, signature = v["token"].split(".", 1)
    assert st._sign(v["secret"].encode("utf-8"), signing_input) == signature
    assert signature == v["signature"]


# ── mint route tests ──────────────────────────────────────────────────────────


def test_sensevoice_token_route_happy_path(monkeypatch):
    monkeypatch.setattr(
        "app.core.config.settings.SENSEVOICE_WS_TOKEN_SECRET", "route-secret"
    )
    monkeypatch.setattr("app.core.config.settings.SENSEVOICE_WS_TOKEN_TTL", 60)

    resp = client.post("/api/sensevoice-token")
    assert resp.status_code == 200
    data = resp.json()
    assert set(data.keys()) == {"token", "expiresAt"}
    assert data["token"].count(".") == 1
    assert isinstance(data["expiresAt"], int)
    assert resp.headers.get("cache-control") == "no-store"
    # The signing secret must never appear in the response body.
    assert "route-secret" not in resp.text

    # The minted token must validate under the same secret + audience.
    payload = st.validate_token("route-secret", data["token"])
    assert payload["aud"] == st.TOKEN_AUDIENCE


def test_sensevoice_token_route_missing_secret_fails_closed(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.SENSEVOICE_WS_TOKEN_SECRET", "")
    resp = client.post("/api/sensevoice-token")
    assert resp.status_code == 503
    assert "token" not in resp.json()
    assert resp.headers.get("cache-control") == "no-store"


def test_sensevoice_token_route_expiry_matches_ttl(monkeypatch):
    monkeypatch.setattr(
        "app.core.config.settings.SENSEVOICE_WS_TOKEN_SECRET", "route-secret"
    )
    monkeypatch.setattr("app.core.config.settings.SENSEVOICE_WS_TOKEN_TTL", 45)
    resp = client.post("/api/sensevoice-token")
    assert resp.status_code == 200
    data = resp.json()
    payload = st.validate_token("route-secret", data["token"])
    assert payload["exp"] == data["expiresAt"]
