# STATUS.md — AITyping Resume Dashboard

> 作用：新 session / 新 agent 開工時，快速知道「而家去到邊、下一步做乜」。
> 詳細錯誤歷史見 `ERRORS.md`；完整 feature/fix 歷史見 `CHANGELOG.md`。

## 1. Current Focus

- **Phase**: Phase 2 — Smart Cleanup (semantic mode) MVP1 已完成並 merge 入 `main`
- **Branch**: `main`（`semantic-dev` 已 merge，工作完成）
- **Frontend URL**: `https://benliu104.github.io/AITyping/` (GitHub Pages)
- **Backend API**: `https://aityping.bochibb.qzz.io` (VPS Docker, Cloudflare Tunnel)
- **SenseVoice API**: `https://sencevoice.bochibb.qzz.io` (VPS host systemd, Cloudflare Tunnel, port 8082)
- **Current deployed frontend build**: UI label `v01:35`（含 Smart Cleanup；已 deploy 並經 Ben 真機確認「效果還可以」）
- **GitHub Actions**: Auto-deploy frontend on push to `semantic-dev` branch (path: `frontend/**`)
- **Current work**: Smart Cleanup (semantic mode) MVP1 已完成、真機驗收通過、merge 入 `main`（commit `4095b44`）。下一步：新開 `uixi` branch 進行 UI 改版。

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
| Backend | ✅ Done | FastAPI：`/api/live-token`、`/api/cleanup`、`/api/smart-cleanup`、`/api/debug-event`；`/api/transcribe` proxy 已移除 |
| Frontend | ✅ Done | Vite PWA、AudioWorklet、LiveClient（Gemini）、SenseVoiceClient（直連 REST）、tap-to-toggle Mic、Smart Cleanup mode 分支 |
| SenseVoice ASR | ✅ Done | systemd `sensevoice-api` port 8082；Cloudflare Tunnel 直通；前端 ArrayBuffer fetch bypass Safari bug；CORS open |
| Gemini Live | ✅ Done | `v1beta` direct WS、`AUDIO` modality、`inputAudioTranscription`、Blob message decode |
| Smart Cleanup (semantic mode) MVP1 | ✅ Done | `/api/smart-cleanup` + adapter `smart_cleanup()`（JSON schema 約束 + regex 搶救 fallback）+ 前端 mode 分支；real API 真機驗收通過，已 merge 入 `main` |
| Deployment | ✅ Done | Frontend: GitHub Actions → GitHub Pages；Backend: VPS Docker + CF Tunnel；SenseVoice: VPS host systemd + CF Tunnel |
| Phase 2 UX polish | ⏳ In Progress | Smart Cleanup MVP1 完成並 merge；下一步 UI 改版（`uixi` branch）+ 其餘 Phase 2 gates（history、debug counters 顯示規則等） |
| Phase 3 stability/security | ⏭️ Later | rate limit、auth/access policy、reconnect、error UX |

## 4. Current Verification Snapshot

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
- **GitHub Pages deploy 有兩層 branch 限制，唔係改 workflow YAML 就夠**：`deploy-frontend.yml` 嘅 `on.push.branches` 淨係控制邊個 branch 觸發 workflow；GitHub repo Settings → Environments → `github-pages` 仲有獨立嘅 deployment branch policy（`gh api repos/BenLiu104/AITyping/environments/github-pages/deployment-branch-policies` 查），呢層淨係允許已列入白名單嘅 branch 真正 deploy，唔喺白名單會 workflow 綠燈但 deploy step 2 秒內以 `environment protection rules` 拒絕。切 deploy trigger branch 時兩層都要對齊。

## 6. Next Steps

1. **UI 改版（🎯 下一步，準備開 `uixi` branch）**
   - 範圍待 Ben 下一步指示
   - 開工前記得：若改動涉及 `frontend/**` 且要真機驗收，`deploy-frontend.yml` trigger branch 現指向 `semantic-dev`，`uixi` 上 push 不會自動 deploy——需要時比照上次流程，同步更新 workflow trigger branch + environment deployment-branch-policy（見 §5 pitfalls），或用 `gh workflow run --ref uixi` 手動觸發（但仍受 environment policy 限制）

2. **Phase 2 收尾觀察**
   - Smart Cleanup real API 已驗收通過；若後續發現語義推斷品質問題，回 `PRD.md` §9 review prompt
   - SenseVoice v2（`v01:35`）持續觀察中；若出現漏句 / stop finalize 問題，先讀 `/tmp/sv-debug/*.summary.json` 對照 production trace
   - 舊 `/ws/transcribe` route 保留作回退

3. **Phase 3 準備（⏭️ 之後）**
   - Rate limiting
   - Token endpoint access policy / auth
   - Better offline / mic denied / API failure UX
