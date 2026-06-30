# Changelog

本檔案紀錄專案的重要產品、架構、部署與安全變更，遵循 [Keep a Changelog](https://keepachangelog.com/) 與 [Conventional Commits](https://www.conventionalcommits.org/)。

> 當前狀態 / 下一步見 `STATUS.md`；debug 根因與避坑見 `ERRORS.md`。

## [Unreleased]

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

### Security
- 前端不 hardcode `GEMINI_API_KEY`；真 key 只存在 backend `.env`。
- `.env`、token、credential 維持 gitignored，不進 tracked files。
- Debug telemetry schema 禁止 transcript/audio/token/credential 類資料。

### Verification
- 新增/更新 frontend regression tests for mic priming、tap-to-toggle、LiveClient、cleanup gating、PWA late error handling。
- 維持 `typecheck` / `lint` / `test` / `build` / backend tests / `check.sh phase1` 作為交付驗證。
- 新增 regression tests 覆蓋 Cantonese-English Live setup hints、App language → speech profile plumbing、cleanup Cantonese ASR repair prompt。
- 新增 regression tests 覆蓋 LiveClient 100ms audio frame aggregation、setupComplete 前 buffer flush、audioStreamEnd 前 partial frame flush。
