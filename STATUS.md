# STATUS.md — AITyping Resume Dashboard

> 作用：新 session / 新 agent 開工時，快速知道「而家去到邊、下一步做乜」。
> 詳細錯誤歷史見 `ERRORS.md`；完整 feature/fix 歷史見 `CHANGELOG.md`。

## 1. Current Focus

- **Phase**: Phase 2 — Cantonese ASR 替換完成，進入 UX polish
- **Frontend URL**: `https://benliu104.github.io/AITyping/` (GitHub Pages, `transcript-improve` branch)
- **Backend API**: `https://aityping.bochibb.qzz.io` (VPS Docker, Cloudflare Tunnel)
- **Current deployed frontend build**: UI label `v12:14`
- **GitHub Actions**: Auto-deploy frontend on push to `transcript-improve` branch (path: `frontend/**`)
- **Milestone**: SenseVoice Cantonese ASR pipeline 已由 Ben 實機確認跑通（v12:14）。

## 2. Current Product Behavior

- Mic 係 **tap-to-toggle**：
  1. 每個 page session 第一次點 Mic：只做 mic permission priming，不錄音。
  2. 第二次點 Mic：開始錄音。
  3. 再點一次 Mic：停止錄音，flush audio，等所有 SenseVoice requests 完成，然後呼叫 `/api/cleanup`。
- **Language routing**：
  - `en` / `zh-Hant` → Gemini Live WebSocket API
  - `yue` / `mixed` → SenseVoice REST API（`https://aityping.bochibb.qzz.io/api/transcribe`）
- SenseVoice 模式：前端每累積 2 秒 PCM（~64KB）encode 成 WAV ArrayBuffer，POST 至後端代理，後端轉發至 host SenseVoice（`http://172.19.0.1:8082`），邊講邊出字。
- 停止錄音後 flush 剩餘 buffer，等全部 in-flight requests 完成，拼接 raw transcript 送 `/api/cleanup`。
- **已知限制**：NordVPN 等 VPN 會在 DNS 層 block `bochibb.qzz.io`，導致 fetch 在手機本地中斷（`Load failed`）。使用時需關閉 VPN。

## 3. Area Status

| Area | Status | Notes |
|---|---:|---|
| Phase 1 MVP | ✅ Done | iPhone / Home Screen PWA 基本流程跑通 |
| Backend | ✅ Done | FastAPI：`/api/live-token`、`/api/cleanup`、`/api/debug-event`、`/api/transcribe`（SenseVoice proxy） |
| Frontend | ✅ Done | Vite PWA、AudioWorklet、LiveClient（Gemini）、SenseVoiceClient（REST）、tap-to-toggle Mic |
| SenseVoice ASR | ✅ Done | systemd `sensevoice-api` port 8082；iptables 已開；Docker bridge `172.19.0.1` 通；ArrayBuffer fetch bypass Safari Blob MIME type bug |
| Gemini Live | ✅ Done | `v1beta` direct WS、`AUDIO` modality、`inputAudioTranscription`、Blob message decode |
| Deployment | ✅ Done | Frontend: GitHub Actions → GitHub Pages；Backend: VPS Docker + Cloudflare Tunnel port 8000 |
| Phase 2 UX polish | 🎯 Current | 下一步見 §6 |
| Phase 3 stability/security | ⏭️ Later | rate limit、auth/access policy、reconnect、error UX |

## 4. Current Verification Snapshot

```text
2026-06-30 ~13:00 PDT — Ben 實機確認 v12:14
- yue mode：SenseVoice 成功接收並轉寫粵語（斷斷續續講都能抓到重點）
- cleanup：raw transcript → 整理後乾淨繁中段落 ✅
- backend log：多個 POST /api/transcribe 200 OK + POST /api/cleanup 200 OK
- transcriptEvents=6, audioChunks=3943 ✅
```

```text
2026-06-30 12:44 PDT — 自動化 CI 驗證
- frontend: tsc --noEmit ✅
- frontend: vitest 30/30 passed ✅
- encodeWAV 返回 ArrayBuffer（不是 Blob）✅
- GitHub Actions deploy: SUCCESS ✅
```

## 5. High-Signal Pitfalls

- **NordVPN / VPN block**：NordVPN 在 iOS 系統層（非瀏覽器層）攔截所有出站 DNS 查詢。`bochibb.qzz.io` 被 Threat Protection 判定可疑，DNS resolve 失敗 → fetch `Load failed`。解法：關閉 VPN 或將 domain 加入白名單。
- **Safari Blob MIME type override bug**：`fetch` body 係 Blob 時，WebKit 採用 Blob 自身 `.type`（`audio/wav`）覆蓋 headers 裡設的 `Content-Type`，觸發 CORS preflight，然後 preflight 在 Safari 內部中斷。解法：用 `ArrayBuffer` 作 fetch body，無內建 MIME type，Safari 必須採用 header 設定。
- **Docker 容器內不能用 `localhost` 連 host**：容器內 `localhost` 指容器自身。連接 host 機服務要用 docker bridge gateway IP（`172.19.0.1`）。
- **iptables 預設 REJECT**：Oracle Cloud 預設封鎖非標準端口。已在 iptables INPUT chain 第 5 位插入 `ACCEPT tcp dport 8082`，並已持久化。
- **pydantic-settings `.env` 優先**：`.env` / env var 永遠覆蓋 pydantic class default。改 CORS / config 後必查 production `.env`。
- **Do not re-add Docker cloudflared connector**：Tunnel 用 host systemd `cloudflared.service`；Docker connector 造成 502。
- **Do not use MediaRecorder**：Live API 依賴 AudioWorklet raw PCM。
- **Do not trust localStorage as mic permission truth**：每個 page session 第一 tap 必定只 prime。
- **Do not parse WS messages as string-only**：Browser 可能交付 Blob；需 normalize 後再 JSON.parse。

## 6. Next Steps

1. **UX polish（可選）**
   - 隱藏 debug counters 或移入 debug mode toggle
   - 加入 raw transcript toggle / undo（cleanup 出錯可恢復）
   - 清晰的 cancel flow（recording 中途可取消）

2. **VPN 相容性（長遠）**
   - 考慮更換一個「正常」的 domain name，降低 VPN Threat Protection 誤判機率

3. **Phase 3 準備**
   - Rate limiting
   - Token endpoint access policy / auth
   - Better offline / mic denied / API failure UX

4. **Merge `transcript-improve` → `main`（待 Ben 確認）**
   - SenseVoice pipeline 已穩定跑通，可考慮 merge 回主線
