# Roadmap — AITyping

開發策略：**先用 PWA 驗證核心引擎，再考慮 native。** 每階段有明確 exit criteria，未達標不跳下一階段。

> 圖例：`[ ]` 未開始 · `[~]` 進行中 · `[x]` 完成

---

## Phase 0 — 專案前期準備（全部 ✅）

**目標：** 在寫任何 code 之前，把規格、規則、結構定清楚，讓 AI agent 開發穩定可控。

- [x] 可行性研究（5 個 session 的答案，存在 `brainstorm/`）
- [x] README / Roadmap / AGENTS / PRD
- [x] git init + `.gitignore`
- [x] `.env.example` / `.editorconfig` / `CHANGELOG.md`
- [x] `docs/adr/` 架構決策紀錄
- [x] 最終確認技術棧（Vite+React+TS / FastAPI）
- [x] 域名 + HTTPS 方案二選一（Caddy / Cloudflare Tunnel -> Cloudflare Tunnel）

**Exit criteria：** AI agent 只看 `AGENTS.md` + `PRD.md` 就知道要 build 什麼、怎麼 build、放哪裡。

---

## Phase 1 — PWA MVP（核心引擎）✅

**目標：** iPhone Safari / Home Screen PWA 打開 → tap-to-toggle 錄音 → 即時 transcript → 停止後 cleanup → textarea → 一鍵 copy。一條 happy path 跑通。

**狀態：** `v09:23` 已由 Ben 實機確認基本流程跑通，且 Home Screen PWA false-positive WebSocket error 已消失。

### 前端
- [x] Vite + React + TS + `vite-plugin-pwa` 腳手架 (B1)
- [x] UI：大 mic button、transcript preview、result textarea、copy / clear (B2)
- [x] `getUserMedia` + AudioContext + AudioWorklet PCM pipeline (B3)
- [x] Float32 → 16kHz Int16 PCM resample（含 unit test） (B3)
- [x] WebSocket 接 Gemini Live API（用後端發 token） (B4)
- [x] 解析 `inputAudioTranscription`，即時更新草稿 (B4)
- [x] 停止錄音 → 呼叫 `/api/cleanup` → 貼結果 (B5/B6)
- [x] Mic UX 改為 tap-to-toggle：點一下開始、放手繼續、再點一下停止

### 後端
- [x] FastAPI app skeleton + health route + CORS + config（讀 `.env`）。
- [x] `gemini/` adapter：包 `google-genai`，集中 model 名。
- [x] `POST /api/cleanup`（flash-lite）+ pydantic schema + test。
- [x] `POST /api/live-token`（簽 ephemeral token）+ test。
- [x] Dockerfile + 加入 docker-compose。

### 部署
- [x] Dockerfile（前後端）+ docker-compose
- [x] Cloudflare Tunnel HTTPS（host systemd `cloudflared.service`）
- [x] iPhone / Home Screen PWA 實機測試基本流程通過 (`v09:23`)

**Exit criteria：** 在 iPhone Safari / Home Screen PWA 真機，講一句中英混合，停止後 3 秒內 textarea 出乾淨文字，可以 copy。✅ `v09:23` 已達成基本 happy path。

---

## Phase 2 — PWA 打磨（變得好用）🎯 Current

- [x] Cleanup 模式：訊息 / Email / TODO / Prompt（B2/B6 提前實作）
- [x] 語言模式：繁中 / 英文 / 中英混合 / Cantonese（內部相容值仍為 `yue`）
- [x] Cantonese / Cantonese-English transcript accuracy polish：Live speech profile hints + cleanup Cantonese ASR repair prompt
- [ ] 即時 partial vs committed transcript 分離（避免跳動）
- [ ] History（本地）、prompt presets / favorites
- [x] Auto-copy after cleanup、震動回饋（B2/B6 提前實作）
- [ ] Cancel flow（tap-to-toggle 後優先考慮 Cancel button，而非上滑手勢）
- [ ] Raw transcript toggle / undo（讓用戶信任 cleanup）
- [ ] Debug counters 隱藏或改為 debug mode

**Exit criteria：** 每天都願意打開來用，cleanup 準到不用再手動改。

---

## Phase 3 — 穩定性與安全強化

- [ ] Rate limiting（後端）
- [ ] 簡單 auth（防止 token endpoint 被濫用）
- [ ] WebSocket 斷線重連 + local buffer（transcript 不 lost）
- [ ] Logging / 監控
- [ ] Offline shell（service worker cache）
- [ ] 錯誤狀態 UX（無網、權限拒絕、API 失敗）

**Exit criteria：** 公開給人用也不會爆 key、不會靜默失敗。

---

## Phase 4 —（未來）Native iOS Keyboard Extension

> ⚠️ 高風險、高摩擦。需要 Mac + Xcode + Apple Developer ($99/年)。Apple 對 keyboard extension 的 mic / Full Access 限制很嚴。確認 PWA 真的每天用，才投資。

- [ ] 評估 keyboard extension mic 限制 of 狀態
- [ ] 復用 PWA 的後端引擎（token + cleanup）
- [ ] Keyboard extension → backend → Gemini
- [ ] `textDocumentProxy.insertText` 插字到任何 app

**Exit criteria：** 在 Telegram / Notes 任何輸入框，按 mic 就能語音輸入。
