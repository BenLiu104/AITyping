# STATUS.md — AITyping Resume Dashboard

> 作用：新 session / 新 agent 開工時，快速知道「而家去到邊、下一步做乜」。
> 詳細錯誤歷史見 `ERRORS.md`；完整 feature/fix 歷史見 `CHANGELOG.md`。

## 1. Current Focus

- **Phase**: Phase 2 — PWA polish / 改善工作
- **Public URL**: `https://aityping.bochibb.qzz.io`
- **Current deployed build**: `v09:23`
- **Milestone**: Phase 1 MVP 基本流程已由 Ben 實機確認跑通。
- **Current goal**: 由「打通流程」轉入「日常好用」：改善 trust、UX、debug visibility、history/presets、stability/security。

## 2. Current Product Behavior

- Mic 是 **tap-to-toggle**：
  1. 每個 page session 第一次點 Mic：只做 mic permission priming，不錄音。
  2. 第二次點 Mic：開始錄音。
  3. 放手：繼續錄音，不停止。
  4. 再點一次 Mic：停止錄音，送 `audioStreamEnd`，等待 transcript，然後呼叫 `/api/cleanup`。
- `v09:23` 已實機確認：Home Screen PWA 基本流程 OK，false-positive `WebSocket 發生錯誤` 已消失。
- Pre-commit automated verification 已通過：frontend typecheck/lint/test/build、backend ruff/pytest、`check.sh phase1`、public smoke。
- Live setup 已修正：browser WebSocket `Blob` response 會先 decode 再 `JSON.parse`。
- 有 transcript 後的 late WebSocket error 只記 telemetry，不顯示 user-facing error 或中斷 cleanup。
- Cleanup 只吃真正 `serverContent.inputTranscription.text`；無 true transcript 不呼叫 `/api/cleanup`。

## 3. Area Status

| Area | Status | Notes |
|---|---:|---|
| Phase 1 MVP | ✅ Done | iPhone / Home Screen PWA `v09:23` 基本流程跑通 |
| Backend | ✅ Done | FastAPI config、`/api/live-token`、`/api/cleanup`、`/api/debug-event` |
| Frontend | ✅ Done / polish next | Vite PWA、AudioWorklet、LiveClient、tap-to-toggle Mic |
| Gemini Live | ✅ Done | `v1beta` direct WS、`AUDIO` modality、`inputAudioTranscription`、Blob message decode |
| Deployment | ✅ Done | Docker frontend/backend；Cloudflare Tunnel 走 host systemd Option A |
| Phase 2 polish | 🎯 Current | raw transcript/undo、partial vs committed、history/presets、debug mode、cancel flow |
| Phase 3 stability/security | ⏭️ Later | rate limit、auth/access policy、reconnect、error UX |

## 4. Current Verification Snapshot

Latest accepted app verification:

```text
ADHOC_RESULT TAP_TOGGLE_V09_23_VERIFY_OK
PUBLIC_BUNDLE_OK /assets/index-D4VwSgM1.js
```

Latest automated verification before commit:

```text
2026-06-28 11:53 PDT
frontend: npm run typecheck ✅; npm run lint ✅; npm run test ✅ (26 passed); npm run build ✅ (/assets/index-D4VwSgM1.js)
backend: ruff check ✅; ruff format --check ✅; pytest ✅ (8 passed, 1 StarletteDeprecationWarning)
check.sh phase1 ✅ (8 passed, 0 failed, 0 skipped)
public smoke: GET / ✅; POST /api/live-token ✅ 200 (token redacted)
docker: sudo docker compose ps ✅ backend/frontend Up; non-sudo docker needs docker group permission
```

Manual verification from Ben:

```text
v09:23 測試 OK，基本流程跑通，false-positive WebSocket error 已消失。
```

## 5. High-Signal Pitfalls

Detailed history is in `ERRORS.md`; keep only current resume-critical pitfalls here:

- **Do not re-add Docker cloudflared connector.** Tunnel uses host systemd `cloudflared.service`; Docker connector caused intermittent 502 because `localhost:8080` pointed at the tunnel container namespace.
- **Do not use MediaRecorder.** Live API path depends on AudioWorklet raw PCM → resample to 16kHz → 16-bit little-endian PCM.
- **Do not treat WebSocket `open` as ready.** Gemini audio should only flush after `setupComplete`.
- **Do not parse WS messages as string-only.** Browser may deliver Google Live messages as `Blob`.
- **Do not send status text to cleanup.** Only true Live transcript goes to `/api/cleanup`.
- **Do not trust localStorage as mic permission truth.** Each page session first tap primes mic only.
- **PRD is now v0.2.** Follow tap-to-toggle and `AUDIO` modality specs, not the old push-to-talk / `TEXT` modality assumptions.

## 6. Next Steps

1. **Phase 2 UX trust improvements**
   - Add raw transcript toggle / undo so cleanup mistakes are recoverable.
   - Split partial vs committed transcript if UI jumping becomes annoying.

2. **Production UI cleanup**
   - Hide visible debug counters or move them behind debug mode.
   - Add a clear cancel flow for tap-to-toggle recording / cleanup.

3. **Convenience improvements**
   - History / local saved drafts.
   - Prompt presets / favorites.

4. **Phase 3 preparation**
   - Rate limiting.
   - Token endpoint access policy / auth.
   - Better offline / mic denied / API failure UX.
