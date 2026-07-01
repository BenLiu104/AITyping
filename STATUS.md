# STATUS.md — AITyping Resume Dashboard

> 作用：新 session / 新 agent 開工時，快速知道「而家去到邊、下一步做乜」。
> 詳細錯誤歷史見 `ERRORS.md`；完整 feature/fix 歷史見 `CHANGELOG.md`。

## 1. Current Focus

- **Phase**: Phase 2 — SenseVoice incremental WS v2 已部署，等 iPhone 真機驗證
- **Frontend URL**: `https://benliu104.github.io/AITyping/` (GitHub Pages, `transcript-improve` branch)
- **Backend API**: `https://aityping.bochibb.qzz.io` (VPS Docker, Cloudflare Tunnel)
- **SenseVoice API**: `https://sencevoice.bochibb.qzz.io` (VPS host systemd, Cloudflare Tunnel, port 8082)
- **Current deployed frontend build**: UI label `v01:35`
- **GitHub Actions**: Auto-deploy frontend on push to `transcript-improve` branch (path: `frontend/**`)
- **Milestone**: frontend + SenseVoice backend 已切到 `/ws/transcribe-v2` incremental event stream，舊 `/ws/transcribe` route 保留作回退。

## 2. Current Product Behavior

- Mic 係 **tap-to-toggle**：
  1. 每個 page session 第一次點 Mic：只做 mic permission priming，不錄音。
  2. 第二次點 Mic：開始錄音。
  3. 再點一次 Mic：停止錄音，flush audio，等所有 SenseVoice / Gemini transcript 完成，然後呼叫 `/api/cleanup`。
- **Language routing（本地工作樹）**：
  - `en` / `zh-Hant` → Gemini Live WebSocket API（`aityping.bochibb.qzz.io/api/live-token`）
  - `yue` / `mixed` → SenseVoice WebSocket incremental stream（`wss://sencevoice.bochibb.qzz.io/ws/transcribe-v2`）
- SenseVoice v2 模式：前端持續送 raw PCM Int16；backend `StreamingTranscriptionBridge` 用 incremental SenseVoice runtime 輸出 `partial_result` / `final_result` / `end_ack`，並在 server 端做 OpenCC 簡轉繁。
- `mixed` 現在送到 SenseVoice `LANG:auto`；`yue` 送 `LANG:yue`；前端 `SenseVoiceWsClient` 只累積 final transcript，避免 partial duplication。
- Live transcript panel 現在顯示 `final + interim`，避免第一句 finalized 後把第二句 partial 完全遮住。
- SenseVoice stop path 現在在 `waitForCompletion()` 空值時，fallback 到當前可見 transcript（`final + interim`），避免 cleanup 因空字串被跳過。
- SenseVoice WS client 現在把 iPhone AudioWorklet 的極細 PCM frames 聚合成約 100ms / 3200 bytes 才送出，停止時會先 flush 剩餘 audio 再送 `END`，debug row 顯示 `end` / `ack` 用嚟確認 backend finalize handshake。
- **已知限制**：NordVPN 等 VPN 會在 DNS 層 block `bochibb.qzz.io` 的 domain，導致 fetch / websocket 中斷。使用時需關閉 VPN。
- 舊 `/ws/transcribe` silence-segmentation route 仍保留，方便回退；但本地新路徑已改用 `/ws/transcribe-v2`。

## 3. Area Status

| Area | Status | Notes |
|---|---:|---|
| Phase 1 MVP | ✅ Done | iPhone / Home Screen PWA 基本流程跑通 |
| Backend | ✅ Done | FastAPI：`/api/live-token`、`/api/cleanup`、`/api/debug-event`；`/api/transcribe` proxy 已移除 |
| Frontend | ✅ Done | Vite PWA、AudioWorklet、LiveClient（Gemini）、SenseVoiceClient（直連 REST）、tap-to-toggle Mic |
| SenseVoice ASR | ✅ Done | systemd `sensevoice-api` port 8082；Cloudflare Tunnel 直通；前端 ArrayBuffer fetch bypass Safari bug；CORS open |
| Gemini Live | ✅ Done | `v1beta` direct WS、`AUDIO` modality、`inputAudioTranscription`、Blob message decode |
| Deployment | ✅ Done | Frontend: GitHub Actions → GitHub Pages；Backend: VPS Docker + CF Tunnel；SenseVoice: VPS host systemd + CF Tunnel |
| Phase 2 UX polish | 🎯 Current | 下一步見 §6 |
| Phase 3 stability/security | ⏭️ Later | rate limit、auth/access policy、reconnect、error UX |

## 4. Current Verification Snapshot

```text
2026-07-01 01:41 PDT — SenseVoice frontend batching / END handshake fix
- frontend: vitest app + SenseVoice WS client 19/19 ✅
- frontend: tsc --noEmit ✅
- frontend: npm run build ✅
- regression covered: tiny PCM frames are batched to 3200-byte WS sends and remaining audio flushes before END ✅
- regression covered: SenseVoice debug row shows end=1 / ack=1 after finalize ack ✅
- regression covered: Cantonese UI mode sends LANG:yue to SenseVoice ✅
```

```text
2026-06-30 23:12 PDT — SenseVoice multi-sentence transcript / cleanup fallback fix
- frontend: vitest app + SenseVoice WS client 16/16 ✅
- frontend: tsc --noEmit ✅
- frontend: npm run build ✅
- regression covered: finalized first sentence no longer masks second-sentence interim ✅
- regression covered: SenseVoice cleanup still runs when waitForCompletion() resolves empty ✅
```

```text
2026-06-30 21:49 PDT — SenseVoice incremental WS v2 deploy verification
- frontend: focused vitest 14/14 ✅
- frontend: tsc --noEmit ✅
- frontend: npm run build ✅
- GH Pages workflow run 28494209785 ✅
- public bundle contains `v12:19` + `/ws/transcribe-v2` ✅
- voice_test: python -m unittest tests.test_ws_v2 -v ✅
- ad-hoc smoke: local ws://127.0.0.1:8082/ws/transcribe-v2 ✅
- ad-hoc smoke: public wss://sencevoice.bochibb.qzz.io/ws/transcribe-v2 ✅
- WS evidence: partial_count=11, final_count=1, last_final="呢幾個字都表達唔到，我想講嘅意思。" ✅
```

```text
2026-06-30 ~13:00 PDT — Ben 實機確認 v12:14
- yue mode：SenseVoice 成功接收並轉寫粵語 ✅
- backend log：POST /api/transcribe 200 OK ×5 + POST /api/cleanup 200 OK ✅
- transcriptEvents=6, audioChunks=3943 ✅
```

## 5. High-Signal Pitfalls

- **NordVPN / VPN block**：NordVPN 在 iOS 系統層攔截所有出站 DNS。`bochibb.qzz.io` 被 Threat Protection 判為可疑，DNS resolve 失敗 → fetch `Load failed`。診斷時必查後端 log 有冇收到請求；零請求即代表手機本地中斷，跟 CORS / Content-Type 無關。
- **Safari Blob MIME type override**：fetch body 係 Blob 時，WebKit 用 Blob 的 `.type` 覆蓋 headers 的 `Content-Type`，觸發 preflight，preflight 對 binary MIME type 在 Safari 內部中斷。解法：用 `ArrayBuffer` 作 fetch body。
- **Docker 容器內不能用 `localhost` 連 host**：要用 docker bridge gateway `172.19.0.1`。（現已不適用，proxy 已移除）
- **iptables port 8082 ACCEPT 保留**：Oracle Cloud 預設 REJECT；已在 INPUT chain 第 5 位插入 ACCEPT，持久化。SenseVoice 現在由 Cloudflare Tunnel 直接服務，iptables rule 對此路徑無影響，但留著對未來 Docker 容器有用。
- **pydantic-settings `.env` 優先**：`.env` 永遠覆蓋 class default。改 CORS / config 後必查 production `.env`。
- **Do not re-add Docker cloudflared connector**：Tunnel 用 host systemd `cloudflared.service`。
- **Do not use MediaRecorder**：Live API 依賴 AudioWorklet raw PCM。
- **Do not parse WS messages as string-only**：Browser 可能交付 Blob；需 normalize 後再 JSON.parse。

## 6. Next Steps

1. **真機驗證（下一步）**
   - iPhone Safari 實測 frontend build `v01:35`：`yue` / `mixed` partial 穩定度、停止錄音 flush、debug `end=1 ack=1`、cleanup 結果
   - 測完讀 `/tmp/sv-debug/*.summary.json` / `.jsonl` / `.wav` 對照 production trace

2. **回退策略保留**
   - 若 v2 在真機上有卡頓或亂跳字，可暫時切回舊 `/ws/transcribe`

3. **Phase 3 準備**
   - Rate limiting
   - Token endpoint access policy / auth
   - Better offline / mic denied / API failure UX

4. **Merge `transcript-improve` → `main`（待 Ben 確認）**
   - 等 v2 真機驗證完成後再考慮 merge 回主線
