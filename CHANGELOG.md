# Changelog

本檔案紀錄專案的重要產品、架構、部署與安全變更，遵循 [Keep a Changelog](https://keepachangelog.com/) 與 [Conventional Commits](https://www.conventionalcommits.org/)。

> 當前狀態 / 下一步見 `STATUS.md`；debug 根因與避坑見 `ERRORS.md`。

## [Unreleased]

### Changed
- `transcript-improve` branch merged into `main`（SenseVoice v2 內容合併回主線）。
- Phase 2 持續進行：新增 `semantic-dev` branch 擴充 cleanup modes。

### Added
- Phase 0 專案治理文件：`README.md`、`Roadmap.md`、`AGENTS.md`、`PRD.md`、`GATES.md`、`STATUS.md`、`ERRORS.md`。
- FastAPI backend：config、CORS、Gemini adapter、`/api/live-token`、`/api/cleanup`。
- Vite + React + TypeScript PWA frontend，包含 manifest 與 service worker 更新註冊。
- iPhone-first 語音輸入 UI：mode/language settings、haptics、mock mode、copy result。
- AudioWorklet mic pipeline：16kHz resampling、16-bit little-endian PCM conversion。
- Gemini Live WebSocket client with Live input transcription support。
- `/api/debug-event` telemetry endpoint for counters/status-only diagnostics。
- Docker production deployment for backend/frontend on ARM64 VPS。
- Phase 2 transcript accuracy polish：Live setup 支援 Cantonese / Cantonese-English speech profile hints，cleanup prompt 加 Cantonese ASR repair 指令。
- GitHub Actions workflow for frontend auto-deploy to GitHub Pages on `transcript-improve` push。
- `VITE_API_BASE_URL` env var support for production API endpoint configuration。
- SenseVoice incremental WebSocket adapter `/ws/transcribe-v2`，輸出 partial/final/end_ack 事件流。

### Changed
- `PRD.md` updated to v0.2：Phase 1 MVP 基本流程已跑通，產品進入 Phase 2 polish。
- `Roadmap.md` / `GATES.md` / `STATUS.md` 對齊 `v09:23` 實機驗收結果，Phase 1 標記為基本完成。
- Mic UX 改為 tap-to-toggle：點一下開始、放手繼續錄、再點一下停止整理。
- Mock mode 改為預設關閉，Mic button 預設走真實錄音流程。
- iOS mic permission flow 改為每個 page session 第一次 tap 只做 permission priming。
- Live transcript 與 UI status 分離，cleanup 只處理 true transcript。
- Gemini Live readiness 改為等待 `setupComplete`，並加入 pre-setup audio buffering。
- Cloudflare Tunnel 部署改為 host systemd `cloudflared.service` only；Docker Compose 不再管理 tunnel connector。
- `AGENTS.md` 文件更新規則明確化：`STATUS.md` / `ERRORS.md` / `CHANGELOG.md` 分工、更新時機與避免重複原則。
- `mixed` 語言模式現在優先視為 Cantonese-English code-switching；`yue` UI 值保留作內部相容，但 user-facing / prompt wording 改用 `Cantonese`。
- Gemini Live audio streaming 改為約 100ms PCM frame 聚合，避免 iPhone / mobile network 每 2–3ms 送一個極細 WebSocket JSON/base64 frame。
- Frontend 部署架構：從 Docker container (nginx) 改為 **GitHub Pages** + GitHub Actions CI/CD。
- Vite `base` 配置加入條件式 `/AITyping/` (GitHub Pages project site subpath) 支援。
- Backend CORS `ALLOWED_ORIGINS` 加入 `https://benliu104.github.io`。
- Cloudflare Tunnel 目標端口從 frontend nginx (8080) 改為 backend (8000)。
- `yue` / `mixed` 本地工作樹改為走 SenseVoice WebSocket `/ws/transcribe-v2`；`mixed` 送 `LANG:auto`，舊 `/ws/transcribe` route 保留作回退。
- SenseVoice WebSocket client 改為約 100ms / 3200-byte PCM frame batching，避免 iPhone AudioWorklet 每 2–3ms 送極細 binary frame。

### Fixed
- 修復 Tailwind 未接入導致 production UI 退化的問題。
- 修復 settings checkbox / switch 點擊問題。
- 修復 Nginx `/api/` reverse proxy 與 AudioWorklet static asset permission 問題。
- 修復 `/api/live-token` 在 Google web token API 不可用時的 fallback。
- 修復 Gemini Live transcript pipeline：modality、input transcription setup、parser、release/cleanup timing。
- 修復 PWA stale cache / service worker 更新問題。
- 修復 iOS mic permission prompt 打斷錄音流程與 localStorage permission 假陽性。
- 修復 browser WebSocket `Blob` response parsing，確保 Live `setupComplete` 可被處理。
- 修復 PWA late WebSocket error 覆蓋成功 transcript/cleanup 流程。
- 修復 Cloudflare Tunnel connector 混用造成的 public URL 間歇 502。
- 收緊 Cantonese / Cantonese-English Live setup prompt 的輸出語言範圍，避免 Mixed mode 漂移到 Japanese kana 或 Korean Hangul。
- 修復 GitHub Pages 空白頁：Vite `base` 未設 `/AITyping/` 導致 asset path 404。
- 修復 CORS 配置被 root `.env` `ALLOWED_ORIGINS` 變數 override 導致 `benliu104.github.io` 被拒絕。
- 修復 SenseVoice WS client 把 partial transcript 重複累積到 completion transcript 的問題。
- 修復 SenseVoice 多句講述時，第一句 finalized 會遮住第二句 interim transcript，並修復 `waitForCompletion()` 空值時 cleanup 被錯誤跳過的問題。
- 修復 SenseVoice 停止錄音時可能未送達 finalize `END` 的問題：停止時先關本地 capture、flush 剩餘 PCM，再等待 backend `end_ack`；debug row 加入 `end` / `ack` 狀態。

## [0.3.1] - 2026-06-30

### Changed
- **架構重構**：移除 AITyping backend 的 `/api/transcribe` proxy route。SenseVoice STT 現由前端直接呼叫 `https://sencevoice.bochibb.qzz.io/transcribe`，各服務各司其職。
- `frontend/src/App.tsx`：`SenseVoiceClient.apiUrl` 從 `aityping.bochibb.qzz.io/api` 改為 `sencevoice.bochibb.qzz.io`。
- `backend/app/main.py`：移除 `transcribe_router` import 及註冊。
- 刪除 `backend/app/routes/transcribe.py`。

## [0.3.0] - 2026-06-30

### Added
- **SenseVoice Cantonese ASR pipeline**：`yue` / `mixed` 語言模式改用本地 SenseVoice（FunASR）做 STT，取代 Gemini Live WebSocket。實機測試確認粵語識別遠優於 Gemini Live。
- 新增 `frontend/src/live/sensevoice-client.ts`：每 2 秒 PCM buffer 切片 encode WAV，POST 至後端代理，`onTranscription` 回傳漸進式結果。
- 新增後端 `/api/transcribe` 代理路由：接收 Raw Binary WAV，轉發至 host SenseVoice（`http://172.19.0.1:8082`）。
- Language routing：`en`/`zh-Hant` → Gemini Live；`yue`/`mixed` → SenseVoice。

### Fixed
- **Safari Blob MIME type override bug**：`encodeWAV` 改返 `ArrayBuffer`（原為 `Blob[audio/wav]`），fetch body 用 `ArrayBuffer`，確保 `Content-Type: text/plain` simple request 不觸發 CORS preflight。
- iptables 開通 port 8082（Oracle Cloud 預設 REJECT），已持久化。
- Docker 容器連接 host SenseVoice 改用 bridge gateway `172.19.0.1`（非 `localhost`）。

### Security
- API key / token 不進前端 bundle，SenseVoice 調用走後端代理。

### Security
- 前端不 hardcode `GEMINI_API_KEY`；真 key 只存在 backend `.env`。
- `.env`、token、credential 維持 gitignored，不進 tracked files。
- Debug telemetry schema 禁止 transcript/audio/token/credential 類資料。

### Verification
- 新增/更新 frontend regression tests for mic priming、tap-to-toggle、LiveClient、cleanup gating、PWA late error handling。
- 維持 `typecheck` / `lint` / `test` / `build` / backend tests / `check.sh phase1` 作為交付驗證。
- 新增 regression tests 覆蓋 Cantonese-English Live setup hints、App language → speech profile plumbing、cleanup Cantonese ASR repair prompt。
- 新增 regression tests 覆蓋 LiveClient 100ms audio frame aggregation、setupComplete 前 buffer flush、audioStreamEnd 前 partial frame flush。
