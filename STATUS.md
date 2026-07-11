# STATUS.md — AITyping Resume Dashboard

> 作用：新 session / 新 agent 開工時，快速知道「而家去到邊、下一步做乜」。
> 詳細錯誤歷史見 `ERRORS.md`；完整 feature/fix 歷史見 `CHANGELOG.md`。

## 1. Current Focus

- **Phase**: Phase 2 — SenseVoice 已由 host systemd migration 到 VPS Docker；下一步係 HF CPU Docker Space migration planning。
- **Branch**: `uiux`（remote `uiux` 包含 container / v2 token / runtime migration commits；`main` 尚未追上。）
- **Frontend URL**: `https://benliu104.github.io/AITyping/` (GitHub Pages)
- **Backend API**: `https://<backend-domain>` (VPS Docker, Cloudflare Tunnel)
- **SenseVoice API**: `https://<sensevoice-domain>`（VPS Docker Compose `sensevoice` service：host 8082 → container 7860，Cloudflare Tunnel）；舊 `sensevoice-api.service` 仍保留作 rollback，但目前 `inactive`。
- **Current deployed frontend build**: 「柔和生活風」淺色 UI（暖米白 `#FFF9EF` + 綠 accent）；已 deploy 並經 Ben 確認「效果都 ok」。cleanup mode re-run UX 已 merge 並經 Ben 真機驗收通過（轉 mode 可流暢改變 cleanup 結果）。
- **GitHub Actions**: Auto-deploy frontend on push to `semantic-dev` / `uixi` / `uiux` branches (path: `frontend/**`)；`github-pages` environment deployment-branch-policy 白名單需含對應 branch 才可真正 deploy。
- **Current work**: 規劃 Hugging Face CPU Docker Space migration。v2 WS token 已 live：`POST /api/sensevoice-token` 簽發約 60 秒 HMAC token，SenseVoice 在建立 bridge / 載模型前驗證。Ben 已接受目前單人 AITyping scope 的安全邊界：v2 token 可作 HF migration gate；legacy endpoint 未 gate、token endpoint 無 user auth / rate limit，若擴大公開使用或流量，必須重新評估。

## 2. Current Product Behavior

- Mic 係 **tap-to-toggle**：
  1. 每個 page session 第一次點 Mic：只做 mic permission priming，不錄音。
  2. 第二次點 Mic：開始錄音。
  3. 再點一次 Mic：停止錄音，flush audio，等所有 SenseVoice / Gemini transcript 完成，然後根據 `mode` 呼叫 `/api/cleanup`（4 種標準模式）或 `/api/smart-cleanup`（`semantic` mode）。
- **Cleanup mode routing（本地工作樹）**：
  - `message` / `email` / `todo` / `prompt` → `POST /api/cleanup`，回傳 `{ cleaned, mode }`，寫入既有 cleanup 欄位。
  - `semantic` → `POST /api/smart-cleanup`，回傳 `{ clean_text, intent_status, reasoning_summary, confidence }`；前端只取 `clean_text` 寫入同一個 cleanup 欄位（其餘 metadata MVP1 不顯示，留 debug/未來用）。兩個 endpoint 互斥，不會並行呼叫。
  - Smart Cleanup 只喺 stop 後、final transcript 非空時觸發一次；interim transcript 不觸發；空 transcript 不觸發（沿用既有「stop 後才呼叫 cleanup」時序，免費繼承這條 acceptance criteria）。
  - Smart Cleanup 失敗時不影響 raw transcript：錯誤訊息走既有 `errorMsg` state 顯示，cleanup 輸出欄位維持空白，不 crash。
  - Cleanup mode can now be changed after cleanup; frontend reuses saved final transcript and re-runs the appropriate cleanup endpoint. Re-cleanup 只替換 cleaned result，不修改 raw transcript、不重錄、不重跑 STT；失敗時保留舊 cleaned result 並顯示 non-blocking error。
- **Language routing（本地工作樹）**：
  - `en` / `zh-Hant` → Gemini Live WebSocket API（先呼叫 `<backend-domain>/api/live-token` 取得 backend-created short-lived ephemeral token；若 token creation 失敗，frontend 顯示安全錯誤並不連線）
  - `yue` / `mixed` → SenseVoice WebSocket incremental stream：先 `POST <backend-domain>/api/sensevoice-token` 取約 60 秒 HMAC token，才連 `wss://<sensevoice-domain>/ws/transcribe-v2?token=...`；v2 驗簽失敗不建立 STT bridge。
- SenseVoice v2 模式：前端持續送 raw PCM Int16；backend `StreamingTranscriptionBridge` 用 incremental SenseVoice runtime 輸出 `partial_result` / `final_result` / `end_ack`，並在 server 端做 OpenCC 簡轉繁。**預設不保留 raw PCM，亦不寫 WAV／JSONL／transcript summary 到 disk**；只有 operator 明確設定 `SENSEVOICE_DEBUG_TRACE=1` 的診斷 process，或測試注入 trace factory，才啟用 trace。
- `mixed` 現在送到 SenseVoice `LANG:auto`；`yue` 送 `LANG:yue`；前端 `SenseVoiceWsClient` 只累積 final transcript，避免 partial duplication。
- Live transcript panel 現在顯示 `final + interim`，避免第一句 finalized 後把第二句 partial 完全遮住。
- SenseVoice stop path 現在在 `waitForCompletion()` 空值時，fallback 到當前可見 transcript（`final + interim`），避免 cleanup 因空字串被跳過。
- SenseVoice WS client 現在把 iPhone AudioWorklet 的極細 PCM frames 聚合成約 100ms / 3200 bytes 才送出，停止時會先 flush 剩餘 audio 再送 `END`，debug row 顯示 `end` / `ack` 用嚟確認 backend finalize handshake。
- **已知限制**：NordVPN 等 VPN 會在 DNS 層 block `<your-domain>` 的 domain，導致 fetch / websocket 中斷。使用時需關閉 VPN。
- 舊 `/ws/transcribe` silence-segmentation route 仍保留，方便回退；但本地新路徑已改用 `/ws/transcribe-v2`。
- **主畫面 UI（`uixi` 本地工作樹，未 deploy）**：改為「柔和生活風」— 暖米白背景、綠色 accent、白色圓角卡片。整理模式 / 語言模式 selector 由 settings drawer 移到主畫面常駐（native `<select>`，`aria-label` = 整理模式 / 語言模式）；預設整理模式改為 `semantic`（智能整理）。Settings gear 只剩 mock + haptics 兩個 toggle。即時聽寫卡加錄音計時器（`mm:ss`）；智能整理結果卡的複製 / 清除為卡內右上角小 icon。底部：中央綠色 mic 大按鈕（唯一 tap-to-toggle 錄音控制）+ 右側「歷史紀錄」按鈕（點擊只彈「歷史紀錄即將推出」placeholder，無儲存邏輯）。debug 遙測列改為只在 `import.meta.env.DEV` 顯示（`vite build` production bundle 已剝除，Vitest 下仍在故 `end=1 ack=1` regression 續綠）。所有錄音 / SenseVoice / Gemini / cleanup / stop-finalize 邏輯零改動。

## 3. Area Status

| Area | Status | Notes |
|---|---:|---|
| Phase 1 MVP | ✅ Done | iPhone / Home Screen PWA 基本流程跑通 |
| Backend | ✅ Done | FastAPI：`/api/live-token`、`/api/sensevoice-token`、`/api/cleanup`、`/api/smart-cleanup`、`/api/debug-event`；SenseVoice token secret 只由 backend / container runtime 持有 |
| Frontend | ✅ Done | Vite PWA、AudioWorklet、LiveClient（Gemini）、SenseVoice v2 WS client（mint token 後連線）、tap-to-toggle Mic、Smart Cleanup mode 分支 |
| SenseVoice ASR | ✅ Done | VPS Docker Compose `sensevoice`（host 8082 → container 7860）；models baked into image；host systemd unit 保留但 inactive 作 rollback；Cloudflare Tunnel 直通 |
| Gemini Live | ✅ Done | `v1alpha` constrained WS + backend ephemeral token、`AUDIO` modality、`inputAudioTranscription`、Blob message decode；`/api/live-token` fail closed，不再回傳 raw API key。★ 完整 setup（含依 `?profile=` 的轉錄語言指令）鎖入 token `live_connect_constraints.config`，前端只送空 `{setup:{}}`（修 constrained endpoint 拒 client setup 的 1011 regression，route 端到端實測 setupComplete）|
| Smart Cleanup (semantic mode) MVP1 | ✅ Done | `/api/smart-cleanup` + adapter `smart_cleanup()`（JSON schema 約束 + regex 搶救 fallback）+ 前端 mode 分支；real API 真機驗收通過，已 merge 入 `main` |
| Deployment | ✅ Done | Frontend: GitHub Actions → GitHub Pages；Backend: VPS Docker + CF Tunnel；SenseVoice: VPS Docker Compose + existing host Cloudflare Tunnel（systemd rollback retained） |
| Phase 2 UX polish | ⏳ In Progress | Smart Cleanup MVP1 完成並 merge；「柔和生活風」主畫面 UI 改版本地完成（layout-only，tests/typecheck/build 全綠，未 deploy / 未真機驗收）；其餘 Phase 2 gates（history 真實功能、debug counters 顯示規則等）待續 |
| Phase 3 stability/security | ⏭️ Later | rate limit、auth/access policy、reconnect、error UX |

## 4. Current Verification Snapshot

```text
2026-07-11 01:41 PDT — VPS Docker migration + v2 token 真機驗收
- `uiux` source: container POC, HMAC v2 token, port-config migration and access-log redaction fixes pushed through `71211e5`.
- Runtime: `aityping-backend` healthy; `aityping-sensevoice-poc` running with host `8082 → 7860`; `sensevoice-api.service` is inactive but retained as rollback.
- Public checks: backend token endpoint returns 200 with `Cache-Control: no-store` and GitHub Pages CORS; SenseVoice `/ping` returns `model_loaded:true`.
- End-to-end: backend-minted token → v2 WS `LANG:yue` + valid PCM + `END` → `end_ack`; container access log redacts token query strings.
- Ben iPhone acceptance: after disabling NordVPN / Threat Protection DNS filtering, SenseVoice mixed-mode flow succeeded. VPN can block `*.bochibb.qzz.io` locally before backend receives a request.
- Scope decision: Ben accepts current v2-token boundary for the single-user HF migration; legacy endpoints and no user/rate-limit policy are documented accepted limits, to revisit if scope expands.
- Next: plan then execute isolated HF CPU Docker Space spike; no VPS cutover until public Space is proven.
```

```text
2026-07-10 16:55 PDT — SenseVoice 容器 POC 修復（feat/sensevoice-container-poc，Attempt-1 review 缺陷修復）
- Dockerfile layer 重排：requirements → pip install → COPY(fetch_models/models.sha256/
  funasr_models.sha256/verify_funasr_cache.py/model_pins.py) → ONNX fetch → FunASR preload →
  verify_funasr_cache → COPY api.py → COPY tests/。api.py/tests 喺所有昂貴 model layer 之後先 COPY。
- Cache-proof（改 api.py 加臨時 marker 再 build）：#8 ONNX fetch = CACHED、#9 FunASR preload = CACHED、
  #15 verify_funasr_cache = CACHED；只有 #16 COPY api.py 重跑。臨時 marker 已完全還原（git checkout 後重貼 pin edits）。
- Model pin：model_pins.py 為 runtime(api.py) + build(Dockerfile preload) 共用單一來源。
  SenseVoiceSmall=3847d57b…、fsmn-vad=df20e6b3…（由現行 host cache 取得，非杜撰）。api.py 兩處 AutoModel 用 model_revision= pin。
- 完整性：streaming ONNX 仍由 package 目錄 sha256sum -c models.sha256（build #8 內 7 檔 OK）；
  baked FunASR .pt 由 funasr_models.sha256 + verify_funasr_cache.py 核對（build #15：9 artifacts All verified）。
- modelscope==1.38.1 pin 入 requirements.txt；Dockerfile 移除獨立 `pip install modelscope`。
- .dockerignore 補排除 loose model blobs（*.onnx/*.pt/*.mvn/*.model 等 + hub/ .cache/ modelscope/ funasr/）。
- 靜態 config 契約測試 tests/test_container_config.py（stdlib，10 tests）：cache 分層 / profile gating / pin 契約，全綠。
- DEPLOY.md：修正重複 heading 編號（§5 測試 → §6 容器化 → §7 已知坑），補「模型 pin 與完整性（容器）」表。
- 測試：sensevoice unittest 15/15 OK（test_ws_v2 5 + test_container_config 10）。
- docker build（native ARM64 aarch64, BuildKit）：成功，image aityping-sensevoice:latest 8.13GB（compressed config ~2.94GB）。
- POC 容器 /ping + WS handshake：見下方 runtime 驗證（LANG + PCM + END → end_ack）。
- systemd sensevoice-api.service：全程 active，:8082 /ping {"model_loaded":true,"status":"ok"} ✅ 未受容器影響。
- x86 / HF Spaces 驗證：⏳ pending（未開始，不在本修復範圍）。
- host systemd 仍為 canonical production 邊界；容器 POC 為實驗性，未上線。
```

```text
2026-07-10 16:20 PDT — SenseVoice 本地容器 POC（feat/sensevoice-container-poc, commit 6103a1d，初版）
- sensevoice/Dockerfile (新增): Python 3.11-slim, UID 1000, port 7860; bake-in streaming ONNX +
  FunASR .pt; CMD uses --preload (api.py supports --host/--port/--preload only).
- sensevoice/.dockerignore (新增): 排除 venv/ __pycache__ *.pyc 等，保留 src/req/checksum/tests.
- docker-compose.yml: sensevoice service, profile sensevoice-local, port 7860; default up 不啟動.
- sensevoice/README.md + DEPLOY.md: 新增 POC 說明、§7 容器狀態表.
- unit tests: 5/5 OK (sensevoice PYTHONPATH venv)
- docker build: 成功, image 3.16 GB (ARM64 aarch64)
- /ping: {"status":"ok","model_loaded":true} OK
- WS handshake: LANG:yue + 3200B PCM frame + END → end_ack received OK
- docker compose logs: server startup / /ping 200 / WS open+close 全可見
- POC container down: aityping-sensevoice-poc removed
- systemd sensevoice-api.service: active, /ping on :8082 {"model_loaded":true,"status":"ok"} ✅
- x86 / HF Spaces 驗證: ⏳ pending
- git diff --check: ✅; .hermes/ 未 stage; commit 6103a1d on feat/sensevoice-container-poc
```

```text
2026-07-10 09:30 PDT — Task 7: extract recording session (refactor/recording-session-boundary)
- 新增 frontend/src/features/recording/use-recording-session.ts（useRecordingSession hook：mic/AudioWorklet/STT 生命週期唯一擁有者）
- 新增 frontend/src/features/recording/use-recording-session.test.ts（7 focused tests：permission priming / real start route 選擇 / AudioWorklet late-message gate after stop / client finalize+teardown / unmount 資源清理）
- App.tsx 縮為 page coordinator：保留 UI JSX + transcript/error/status/debug state + cleanup 整合；透過 typed callback contract 驅動 hook。兩個 transport client 不合併；public/pcm-processor.js 零改動；endpoint/payload/protocol/model 邏輯零改動
- TDD RED→GREEN：先寫 hook 測試（module 未解析 → 1 failed），實作後 7/7 綠
- typecheck ✅ / oxlint 0 warn ✅ / vitest 77/77（新 7 + 既有 70 全保留）✅ / build ✅（PWA precache 13 entries）
- git diff --check ✅；**未做 iPhone Safari 真機驗收**（en/繁中 Live + yue/mixed SenseVoice 真機聽寫待 Ben 驗）
```

```text
2026-07-10 09:08 PDT — Task 6: extract cleanup boundary (refactor/cleanup-boundary) — 修復後
- 新增 frontend/src/features/cleanup/cleanup-api.ts（typed fetch boundary，帶 AbortSignal）
- 新增 frontend/src/features/cleanup/use-cleanup.ts（cleanup hook，AbortController 生命週期）
- 新增 frontend/src/features/cleanup/use-cleanup.test.ts（22 focused tests，含 abort-on-new-run/reset/unmount + mock guard equivalence）
- App.tsx 只作協調器；callCleanupAPI / callSmartCleanupAPI / runCleanup 內聯函數全部移入 hook/api 層
- 修復 code review IMPORTANT：(1) 加入 AbortController policy（新 run/reset/unmount 取消前一個請求，取消後不再寫 state）；(2) rerunCleanup 移除 mockMode 參數，只用注入的 mockCleanup；(3) 還原 mic/Live/pipeline/copy 錯誤路由回 App 自有 errorMsg 紅框（不再誤送 liveStatus）
- typecheck ✅ / oxlint 0 warn ✅ / vitest 70/70（cleanup 檔 22/22）✅ / build ✅（PWA precache 13 entries）
- git diff --check ✅；未做 iPhone 真機驗收
```

```text
2026-07-10 08:12 PDT — Task 2: check.sh G1.3/G1.4b gate truthfulness fix
- RED proof（修正前）：ruff format --check exit 1，但舊腳本仍 exit 0（gate 計 SKIP）
- check.sh 修正：`.venv/bin/ruff` 存在與否決定 SKIP，存在但 exit non-zero → nogate(FAIL)；同樣修正 pytest 閘門
- GREEN：backend ruff format 2 files reformatted（adapter.py / test_adapter.py）；backend ruff check / format check、pytest 32/32 ✅；`bash check.sh phase1` 8 pass / 0 fail / 0 skip ✅
- 反向 proof：暫時加入 formatter-only probe 後，`bash check.sh phase1` 在 G1.3 正確 FAIL 並 exit 1；probe 已還原，無殘留修改
- `bash check.sh all` 只因 feature branch / dirty working tree 的 G0.2b/G0.2c 而 exit 1；`git diff --check` ✅。
```

```text
2026-07-10 02:48 PDT — SenseVoice v2 default raw-audio trace disabled（local only，未部署）
- RED: venv/bin/python -m unittest tests.test_ws_v2.StreamingTranscriptionBridgeTests.test_default_bridge_trace_is_noop_and_never_creates_trace_directory tests.test_ws_v2.StreamingTranscriptionBridgeTests.test_bridge_forwards_trace_lifecycle_to_injected_trace_factory -v → 預設 trace 嘗試寫 JSONL，且 bridge 未接受 trace_factory（預期失敗）
- GREEN: 同一聚焦 command 2/2 ✅；預設 bridge 不建立測試 trace 目錄、不持有 raw_audio，injected fake trace 收到完整 lifecycle。
- full: cd sensevoice && venv/bin/python -m unittest tests.test_ws_v2 -v → 4/4 ✅。
- 未驗證：iPhone Safari 真機／production service 未重新驗證；本 task 沒有 deploy、restart 或檢查既有 `/tmp/sv-debug` artifacts。
```

```text
2026-07-08 15:00 PDT — Gemini Live 1011 regression 修好（constrained endpoint setup 鎖入 token）
- 根因：v1alpha BidiGenerateContentConstrained WS 拒絕 client 送出的任何 setup（連空 {} 亦 1011）。正解＝完整 setup 鎖入 ephemeral token 的 live_connect_constraints.config，前端只送空 {setup:{}}。
- backend（container 內）: python -m pytest 32/32 ✅（新增 profile route forward / unknown-profile normalize / 5 條 parametrized instruction-by-profile）; ruff check ✅
- frontend canonical: typecheck ✅ / oxlint 0 warn ✅ / vitest 48/48 ✅（刪 1 條過時 client-side systemInstruction test）/ build ✅（PWA precache 13 entries）
- ★ 端到端實測（真 Google endpoint，經真 /api/live-token route）：english / cantonese-english / auto profile 全部回 setupComplete ✅（rebuild 前同一 route 1011，rebuild 後 setupComplete＝新 code 已上線鐵證）
- backend 部署：docker compose up -d --build backend → 四閘全通（container Up:8000 / startup complete 無 traceback / GET /health 200 / route setupComplete）
- 未驗證：iPhone Safari 真機 en / 繁中 Live 聽寫（待 frontend CI deploy 後 Ben 真機）
```

```text
2026-07-10 PDT — Docker context hygiene (Task 3, chore/docker-context-hygiene)
- backend/.dockerignore created; build context: ~135MB → ~52KB ✅
- frontend/.dockerignore created; build context: ~261MB → ~914KB ✅
- .env.example CF_TUNNEL_TOKEN stale entry removed ✅
- `bash check.sh phase1`: 7 pass / 0 fail / 1 skip ✅（skip 係 main 尚未併入 Task 2 Ruff gate fix 時的既有行為）
```

```text
2026-07-08 11:05 PDT — Gemini Live raw API key fallback removed
- backend: .venv python -m pytest 22/22 ✅（新增 auth_tokens.create success/failure + route safe-failure regressions）
- frontend focused: npm run test -- --run src/test/app.test.tsx src/live/live-client.test.ts 43/43 ✅
- frontend: npm run typecheck ✅
- frontend: npm run build ✅（vite production bundle built, PWA precache 6 entries）
- lints: edited backend/frontend files no IDE lint errors ✅
- production bundle grep: `GEMINI_API_KEY` / `GOOGLE_API_KEY` / `VITE_*GEMINI` / `VITE_*GOOGLE` / `AIza` all 0 matches ✅
- SDK surface check: installed `google-genai` exposes `client.auth_tokens` ✅
- local actual-key scan: repo `.env` not present, so no real key value available to scan
- backend/scripts/verify_live_ephemeral_token.py smoke: exits non-zero safely without `.env` (`ValueError: API Key 缺失`), prints no secret
- follow-up TTL validation fix: backend pytest 25/25 ✅; `ruff check` edited backend files ✅; route rejects `ttl=-1` with 422 and adapter rejects `ttl_seconds <= 0` before SDK call
- 未驗證：real Gemini `auth_tokens.create` against production `.env` / billing-enabled API key
```

```text
2026-07-07 18:09 UTC — Cleanup mode re-run after cleanup (merged uixi → main)
- frontend: npm run test -- --run src/test/app.test.tsx 29/29 ✅（新增 5 條 mode-change re-cleanup regression：標準 cleanup、semantic cleanup、recording 中不觸發、無 transcript 不觸發、失敗保留舊結果）
- frontend: npm run typecheck ✅
- frontend: npm run build ✅（tsc -b + vite build，PWA precache 6 entries）
- 行為：cleanup 完成後切換整理模式會用 saved final raw transcript re-run `/api/cleanup` 或 `/api/smart-cleanup`；raw transcript 不變，不重錄、不觸發 STT
- 未驗證：iPhone Safari 真機、public domain deploy 後 smoke test
```

```text
2026-07-06 20:12 PDT — SenseVoice 執行路徑遷移到 repo + 可重現部署工具鏈（commit 9e079bf）
- 遷移：systemd unit WorkingDirectory/ExecStart 由 experiment/voice_test → repo sensevoice/；restart 後 NRestarts=0（無 crash loop）
- /ping: {"model_loaded":true,"status":"ok"}，連續多次 stable；running process cwd=repo sensevoice/，用 repo venv/bin/python
- WS end-to-end（歷史 deployment snapshot，當時 trace 為預設開啟）：/ws/transcribe-v2 connection opened→trace saved→closed 200；trace language=yue、chunk_count=34、total_bytes=32000（合成 sine 非語音故 final_count=0，屬正確）。現行 code 預設不再落 disk trace。
- setup.sh: fresh venv 建成 → 全 import OK；systemd-env smoke test model_loaded:true
- fetch_models.py: 隔離 dogfood 由 ModelScope iic/*（pinned）下載 → sha256 7/7 OK
- ad-hoc verify script: 25/25 PASS（setup.sh/requirements/models.sha256/template/live-service/ERRORS）
- 保留：舊 experiment/voice_test/venv 未刪（2.1G，rollback 安全網）；unit backup .bak.pre-migrate 保留
- 未驗證：iPhone Safari 真機經 CF tunnel 打 wss（本 session 無裝置）— 下次 Ben 真機順帶確認
```

```text
2026-07-06 12:14 PDT — 「柔和生活風」主畫面 UI 改版（uixi，layout-only）
- frontend: npx vitest run 43/43 ✅（40 原有 + 3 新增：預設 semantic mode、兩個 selector 常駐、歷史紀錄 placeholder 開關）
- frontend: npx tsc --noEmit ✅
- frontend: npm run build ✅（tsc -b + vite build，44 modules，PWA precache 6 entries）
- 改動檔案：App.tsx（JSX 重寫 + 預設 mode=semantic + 計時器/placeholder additive state）、index.css（暖色 tokens）、vite.config.ts（PWA theme/bg color）、test/app.test.tsx（6 個既有 test 的 setup 適配 + 3 個新 test，斷言意圖不變）
- ad-hoc 驗證：production bundle grep 確認 debug 遙測列（`bytes=` / `setup=` / 字面 `debug `）0 命中 → DEV-gate 剝除成功；主畫面字串（整理模式/語言模式/即時聽寫/智能整理結果/歷史紀錄）皆在 bundle 內 ✅
- 未驗證：iPhone Safari 真機（本 session 無裝置）、未 deploy（uixi push 不自動觸發 GH Pages）— 下一步待辦
```

```text
2026-07-04 18:03 PDT — Smart Cleanup (semantic mode) MVP1 implemented
- backend: pytest 18/18 ✅（含 6 條新 smart_cleanup adapter test + 3 條新 route test）
- backend: ruff check . ✅, ruff format . --check ✅
- frontend: npm run test 40/40 ✅（含 5 條新 Smart Cleanup describe block test：觸發時機、interim 不觸發、空 transcript 不觸發、成功顯示、失敗不影響 raw transcript）
- frontend: npm run typecheck ✅
- frontend: npm run build ✅
- frontend: npm run lint (oxlint) ✅
- dist/ bundle grep GEMINI_API_KEY → 無命中 ✅
- 未驗證：real（非 mock）Gemini API 呼叫、iPhone Safari 真機測試 — 下一步待辦
```

```text
2026-07-02 10:04 PDT — Phase 2 持續：cleanup mode 擴充
- `transcript-improve` 已 merge 入 `main`（SenseVoice v2 內容）
- 新 branch `semantic-dev` 從 `main` 開出，準備加「semantic」cleanup mode
- Phase 2 未關閉，繼續 cleanup UX polish
```

```text
2026-07-01 01:52 PDT — Ben iPhone PWA acceptance
- frontend build `v01:35` 真機效果滿意 ✅
- SenseVoice v2 多句 / stop finalize 行為可暫時收工 ✅
- project state converged into STATUS / CHANGELOG / ERRORS ✅
```

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
- ad-hoc smoke: public wss://<sensevoice-domain>/ws/transcribe-v2 ✅
- WS evidence: partial_count=11, final_count=1, last_final="呢幾個字都表達唔到，我想講嘅意思。" ✅
```

```text
2026-06-30 ~13:00 PDT — Ben 實機確認 v12:14
- yue mode：SenseVoice 成功接收並轉寫粵語 ✅
- backend log：POST /api/transcribe 200 OK ×5 + POST /api/cleanup 200 OK ✅
- transcriptEvents=6, audioChunks=3943 ✅
```

## 5. High-Signal Pitfalls

- **NordVPN / VPN block**：NordVPN 在 iOS 系統層攔截所有出站 DNS。`<your-domain>` 被 Threat Protection 判為可疑，DNS resolve 失敗 → fetch `Load failed`。診斷時必查後端 log 有冇收到請求；零請求即代表手機本地中斷，跟 CORS / Content-Type 無關。
- **Safari Blob MIME type override**：fetch body 係 Blob 時，WebKit 用 Blob 的 `.type` 覆蓋 headers 的 `Content-Type`，觸發 preflight，preflight 對 binary MIME type 在 Safari 內部中斷。解法：用 `ArrayBuffer` 作 fetch body。
- **Docker 容器內不能用 `localhost` 連 host**：要用 docker bridge gateway `172.19.0.1`。（現已不適用，proxy 已移除）
- **iptables port 8082 ACCEPT 保留**：Oracle Cloud 預設 REJECT；已在 INPUT chain 第 5 位插入 ACCEPT，持久化。SenseVoice 現在由 Cloudflare Tunnel 直接服務，iptables rule 對此路徑無影響，但留著對未來 Docker 容器有用。
- **SenseVoice venv 不可搬移（redeploy 必讀）**：venv `bin/` 內 script（pip 等）shebang 寫死絕對路徑，`mv`／`cp -r` 去新路徑即壞（exec pip → `FileNotFoundError`，funasr 載模型時 self-`pip install` 撞正 → crash loop `status=6/ABRT`）。**換路徑＝喺新路徑重跑 `sensevoice/setup.sh` 重建**，切勿搬 venv。詳見 `sensevoice/DEPLOY.md` §6 + `ERRORS.md`。
- **SenseVoice 模型 = ModelScope submodule，pip-from-git 唔會落**：`pip install git+...` 攞到嘅 `model_quant.onnx` 係細指標檔（非真權重）→ onnxruntime `InvalidProtobuf`。`setup.sh` 會自動跑 `fetch_models.py` 由 ModelScope `iic/*`（pinned revision）下載，`models.sha256` 把關。
- **pydantic-settings `.env` 優先**：`.env` 永遠覆蓋 class default。改 CORS / config 後必查 production `.env`。
- **Do not re-add Docker cloudflared connector**：Tunnel 用 host systemd `cloudflared.service`。
- **Do not use MediaRecorder**：Live API 依賴 AudioWorklet raw PCM。
- **Do not parse WS messages as string-only**：Browser 可能交付 Blob；需 normalize 後再 JSON.parse。
- **Gemini Live token endpoint must fail closed**：`/api/live-token` 只能回傳 backend 用 `google-genai` `auth_tokens.create` 建立的 short-lived `auth_tokens/...` ephemeral token；任何 SDK/API/config failure 都不可 fallback 到 raw `GEMINI_API_KEY`，route response 亦不可 echo token / key / exception detail。
- **GitHub Pages deploy 有兩層 branch 限制，唔係改 workflow YAML 就夠**：`deploy-frontend.yml` 嘅 `on.push.branches` 淨係控制邊個 branch 觸發 workflow；GitHub repo Settings → Environments → `github-pages` 仲有獨立嘅 deployment branch policy（`gh api repos/BenLiu104/AITyping/environments/github-pages/deployment-branch-policies` 查），呢層淨係允許已列入白名單嘅 branch 真正 deploy，唔喺白名單會 workflow 綠燈但 deploy step 2 秒內以 `environment protection rules` 拒絕。切 deploy trigger branch 時兩層都要對齊。

## 6. Next Steps

1. **HF CPU Docker Space migration（下一步，已寫 plan）**
   - Plan：`.hermes/plans/2026-07-11_014108-hf-cpu-space-migration.md`
   - 順序：x86/Docker Hub immutable digest → isolated public HF Space → token WS protocol/cold-start/resource gates → frontend URL cutover → Ben 真機驗收 → 才停止 VPS Compose STT。
   - HF CPU Basic 現有公開規格為 2 vCPU / 16GB RAM / 50GB ephemeral disk；x86 build、Space WS proxy、cold start 都仍需實測。

2. **UI 改版（✅ 完成並 merge 入 `main`）**
   - 「柔和生活風」主畫面已 deploy、Ben 確認「效果都 ok」，`uixi` → `main` merge 完成；plan 見 `UI_change.md`
   - cleanup mode re-run UX 已 merge 並真機驗收通過（轉 mode 可流暢改變 cleanup 結果）
   - 未收尾：`歷史紀錄` 目前只是 placeholder（點擊彈「即將推出」），真實 history 功能未實作

3. **加 app icon（✅ 完成，`uiux` branch，未真機驗收）**
   - 由單張 1254² 原圖 resize 出全套：`pwa-64/192/512`、`maskable-512`（80% safe zone）、`apple-touch-icon-180`、`favicon.ico/png`，全部米白底配「柔和生活風」
   - 修正 `vite.config.ts` manifest icon 引用 bug（typo `512x1512` + 唔存在的 `mask-icon.svg`）；`index.html` 加 `apple-touch-icon` link
   - build precache 6 → 13 entries，typecheck / test 48 / build 全綠；**未 iOS Home Screen 真機裝過**

4. **Phase 2 收尾觀察**
   - Smart Cleanup real API 已驗收通過；若後續發現語義推斷品質問題，回 `PRD.md` §9 review prompt
   - SenseVoice v2 預設不落 disk trace；如 operator 明確暫時啟用 `SENSEVOICE_DEBUG_TRACE=1` 做診斷，才按其 trace 輸出排查漏句／stop-finalize；不要檢查或依賴既有 raw-audio artifacts
   - 舊 `/ws/transcribe` route 保留作回退

5. **Phase 3 準備（⏭️ 之後）**
   - Rate limiting
   - Token endpoint access policy / auth
   - Better offline / mic denied / API failure UX