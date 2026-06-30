# STATUS.md — AITyping Resume Dashboard

> 作用：新 session / 新 agent 開工時，快速知道「而家去到邊、下一步做乜」。
> 詳細錯誤歷史見 `ERRORS.md`；完整 feature/fix 歷史見 `CHANGELOG.md`。

## 1. Current Focus

- **Phase**: Phase 2 — 架構清理完成，進入 UX polish
- **Frontend URL**: `https://benliu104.github.io/AITyping/` (GitHub Pages, `transcript-improve` branch)
- **Backend API**: `https://aityping.bochibb.qzz.io` (VPS Docker, Cloudflare Tunnel)
- **SenseVoice API**: `https://sencevoice.bochibb.qzz.io` (VPS host systemd, Cloudflare Tunnel, port 8082)
- **Current deployed frontend build**: UI label `v12:15`
- **GitHub Actions**: Auto-deploy frontend on push to `transcript-improve` branch (path: `frontend/**`)
- **Milestone**: 架構重構完成（v12:15）：SenseVoice 直連，AITyping proxy 已移除。

## 2. Current Product Behavior

- Mic 係 **tap-to-toggle**：
  1. 每個 page session 第一次點 Mic：只做 mic permission priming，不錄音。
  2. 第二次點 Mic：開始錄音。
  3. 再點一次 Mic：停止錄音，flush audio，等所有 SenseVoice requests 完成，然後呼叫 `/api/cleanup`。
- **Language routing**：
  - `en` / `zh-Hant` → Gemini Live WebSocket API（`aityping.bochibb.qzz.io/api/live-token`）
  - `yue` / `mixed` → SenseVoice REST API **直連**（`https://sencevoice.bochibb.qzz.io/transcribe`）
- SenseVoice 模式：前端每累積 2 秒 PCM encode 成 WAV **ArrayBuffer**，以 `Content-Type: text/plain` POST 至 SenseVoice，繞過 Safari CORS preflight bug，邊講邊出字。
- 停止錄音後 flush 剩餘 buffer，等全部 in-flight requests 完成，拼接 raw transcript 送 `aityping.bochibb.qzz.io/api/cleanup`。
- **已知限制**：NordVPN 等 VPN 會在 DNS 層 block `bochibb.qzz.io` 的 domain，導致 fetch 中斷。使用時需關閉 VPN。
- SenseVoice Flask server 有 `CORS(app)`（`flask-cors`，`allow_origins=*`），前端直連無 CORS 問題。

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
2026-06-30 13:28 PDT — v12:15 架構重構驗證
- frontend: tsc --noEmit ✅
- frontend: vitest 30/30 ✅
- App.tsx apiUrl = sencevoice.bochibb.qzz.io ✅
- backend /api/transcribe → 404 (proxy 已移除) ✅
- backend /health → 200 healthy ✅
- transcribe.py 已從 repo 刪除 ✅
- GitHub Pages v12:15 deploy: SUCCESS ✅
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

1. **UX polish（可選）**
   - 隱藏 debug counters 或移入 debug mode toggle
   - 加入 raw transcript toggle / undo（cleanup 出錯可恢復）
   - 清晰的 cancel flow（recording 中途可取消）

2. **VPN 相容性（長遠）**
   - 考慮更換更「正常」的 domain name，降低 VPN Threat Protection 誤判機率

3. **Phase 3 準備**
   - Rate limiting
   - Token endpoint access policy / auth
   - Better offline / mic denied / API failure UX

4. **Merge `transcript-improve` → `main`（待 Ben 確認）**
   - SenseVoice pipeline 穩定跑通，架構清理完成，可考慮 merge 回主線
