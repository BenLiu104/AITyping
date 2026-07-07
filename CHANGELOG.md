# Changelog

本檔案紀錄專案的重要產品、架構、部署與安全變更，遵循 [Keep a Changelog](https://keepachangelog.com/) 與 [Conventional Commits](https://www.conventionalcommits.org/)。

> 當前狀態 / 下一步見 `STATUS.md`；debug 根因與避坑見 `ERRORS.md`。

## [Unreleased]

### Added
- SenseVoice STT 可重現部署工具鏈（開源 / redeploy 前提）：`sensevoice/setup.sh` 一鍵就地建 venv + 裝依賴 + 取模型 + sha256 把關；`sensevoice/fetch_models.py` 由 ModelScope 官方 `iic/*`（pinned revision）下載 streaming ONNX 權重並 copy 入 package；`sensevoice/models.sha256`（7 檔）做完整性 manifest；`sensevoice/sensevoice-api.service.template`（`__INSTALL_DIR__` / `__RUN_USER__` 佔位符）做 infra-as-code。`requirements.txt` 修正為真正可安裝：`sense-voice-streaming-asr` 改用 git+commit pin（非 PyPI，會 404）、補回 `torch` / `torchaudio` CPU wheel。`DEPLOY.md` §2/§3/§6 重寫對齊新流程。
- GitHub Pages frontend deploy workflow now also triggers on `uiux` branch pushes.
- Cleanup mode re-run UX：停止錄音並完成整理後，使用者可切換整理模式，前端會保留同一份 final raw transcript 並重新呼叫對應 cleanup endpoint（標準模式 `/api/cleanup`、智能整理 `/api/smart-cleanup`），只替換整理結果，不重錄、不重跑 STT；re-cleanup 失敗時保留原逐字稿與舊整理結果。

### Security
- Public-repo hygiene：從 tracked tree 移除 origin VPS IP（`<VPS_IP>` 佔位）、絕對 home 路徑（`<INSTALL_DIR>` / `<DEPLOY_USER>`）、及可識別的服務 domain（`<backend-domain>` / `<sensevoice-domain>`）。VPS IP 屬真實洩露（架構本應以 Cloudflare Tunnel 隱藏 origin），domain 則為降低 fork 耦合。註：僅清理當前 tree，git 歷史舊 commit 仍含舊值（未做 history rewrite）。
- 前端不再 hardcode 後端 / SenseVoice endpoint：`VITE_API_BASE_URL` 與新增 `VITE_SENSEVOICE_WS_URL` 於 build time 由 GitHub Actions repo variables 注入（deploy workflow 缺變數即 fail-fast，不再 fallback 到寫死 domain）。local dev 未設變數時 SenseVoice WS fallback 到同源 `/ws/transcribe-v2`。
- 後端 CORS `ALLOWED_ORIGINS` code 預設值由 production domain 改為 `localhost`（生產 origin 一律由 `.env` 提供）。

### Added
- 主畫面「柔和生活風」UI 改版（layout-only）：暖米白背景 + 綠色 accent + 白色圓角卡片；整理模式 / 語言模式 selector 由 settings drawer 移到主畫面常駐；即時聽寫卡新增錄音計時器（`mm:ss`）；底部新增「歷史紀錄」按鈕（placeholder，點擊彈「歷史紀錄即將推出」modal，尚無真實 history 儲存邏輯）。錄音 / SenseVoice / Gemini / cleanup / stop-finalize 邏輯零改動。
- `POST /api/smart-cleanup`：`semantic` cleanup mode MVP1（Smart Cleanup）— 對停止錄音後嘅完整最終逐字稿做語義層整理，推斷用戶最終真正想講嘅意思（處理猶豫、自我修正、改變主意），非純文法修正。回應 `{ clean_text, intent_status, reasoning_summary, confidence }`；前端只顯示 `clean_text`，寫入既有 cleanup 輸出欄位。
- `GeminiAdapter.smart_cleanup()`：用 `response_mime_type: application/json` + `response_schema` 約束 Gemini 輸出；解析失敗時 regex 搶救 `clean_text`，完全無法搶救才拋錯。

### Changed
- 預設整理模式由 `message` 改為 `semantic`（智能整理）— 開 app 即預選 Smart Cleanup。
- Settings drawer 精簡為只剩 mock 模式 + haptics 兩個 toggle（mode / language selector 已移出到主畫面）。
- debug 遙測列改為只在 `import.meta.env.DEV` 顯示，`vite build` production bundle 已剝除（Vitest 下仍渲染，故既有 `end=1 ack=1` regression 維持）。
- PWA manifest `theme_color` / `background_color` 由 `#1a1a1a` 改為暖米白 `#FFF9EF`，配合新淺色 UI（避免 iOS 安裝啟動畫面色差）。
- `index.css` `:root` / `body` 由 dark（`#121212`）改為暖淺色，並加入「柔和生活風」CSS 自訂變數 tokens；app shell 由固定 `h-screen overflow-hidden` 改為 `min-h-screen` 自然文檔流以配合常駐 selector + 計時器內容。
- 語義整理 mode 的 `<select>` option 顯示文字由「語義整理」改為「智能整理」（value `semantic` 與所有邏輯不變）。
- `Mode` type 新增 `'semantic'` 選項；前端 mode dropdown 加對應 UI option。
- 前端 stop-recording flow（`stopRealRecording` / `stopMockRecording`）改用 `runCleanupForCurrentMode()` 分支：`semantic` mode 打 `/api/smart-cleanup`，其餘 4 種 mode 維持打 `/api/cleanup`（不變）；兩者互斥，不並行呼叫。
- `deploy-frontend.yml` deploy trigger branch：`transcript-improve` → `semantic-dev`；同步更新 GitHub repo `github-pages` environment 的 deployment-branch-policy 白名單（移除 `transcript-improve`，加入 `semantic-dev`）。
- `transcript-improve` branch merged into `main`（SenseVoice v2 內容合併回主線）。
- `semantic-dev` branch merged into `main`（Smart Cleanup MVP1，real API 真機驗收通過後合併）。
- `uixi` branch merged into `main`（「柔和生活風」主畫面 UI 改版，deploy 後 Ben 確認「效果都 ok」）。
- `deploy-frontend.yml` deploy trigger branch 加入 `uixi`（`semantic-dev` 保留）；同步將 `uixi` 加入 `github-pages` environment 的 deployment-branch-policy 白名單，供 UI 改版真機測試自動 deploy。

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
- **架構重構**：移除 AITyping backend 的 `/api/transcribe` proxy route。SenseVoice STT 現由前端直接呼叫 `https://<sensevoice-domain>/transcribe`，各服務各司其職。
- `frontend/src/App.tsx`：`SenseVoiceClient.apiUrl` 從 `<backend-domain>/api` 改為 `<sensevoice-domain>`。
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