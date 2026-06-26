# Roadmap — AITyping

開發策略：**先用 PWA 驗證核心引擎，再考慮 native。** 每階段有明確 exit criteria，未達標不跳下一階段。

> 圖例：`[ ]` 未開始 · `[~]` 進行中 · `[x]` 完成

---

## Phase 0 — 專案前期準備（當前）

**目標：** 在寫任何 code 之前，把規格、規則、結構定清楚，讓 AI agent 開發穩定可控。

- [x] 可行性研究（5 個 session 的答案，存在 `brainstorm/`）
- [x] README / Roadmap / AGENTS / PRD
- [x] git init + `.gitignore`
- [x] `.env.example` / `.editorconfig` / `CHANGELOG.md`
- [x] `docs/adr/` 架構決策紀錄
- [ ] 最終確認技術棧（Vite+React+TS / FastAPI）
- [ ] 域名 + HTTPS 方案二選一（Caddy / Cloudflare Tunnel）

**Exit criteria：** AI agent 只看 `AGENTS.md` + `PRD.md` 就知道要 build 什麼、怎麼 build、放哪裡。

---

## Phase 1 — PWA MVP（核心引擎）

**目標：** iPhone Safari 打開 → 按住說話 → 即時 transcript → 放開 cleanup → textarea → 一鍵 copy。一條 happy path 跑通。

### 前端
- [ ] Vite + React + TS + `vite-plugin-pwa` 腳手架
- [ ] UI：大 mic button、transcript preview、result textarea、copy / clear
- [ ] `getUserMedia` + AudioContext + AudioWorklet PCM pipeline
- [ ] Float32 → 16kHz Int16 PCM resample（含 unit test）
- [ ] WebSocket 接 Gemini Live API（用後端發 token）
- [ ] 解析 `inputAudioTranscription`，即時更新草稿
- [ ] 放開 → 呼叫 `/api/cleanup` → 貼結果

### 後端
- [ ] FastAPI app skeleton + health route
- [ ] `POST /api/live-token`（簽發 Gemini ephemeral token）
- [ ] `POST /api/cleanup`（呼叫 gemini-3.1-flash-lite）
- [ ] Gemini adapter 層（隔離 model / API 變動）
- [ ] CORS、基本 error handling
- [ ] **Mock 模式**（不燒 API 也能開發前端）

### 部署
- [ ] Dockerfile（前後端）+ docker-compose
- [ ] Caddy / Cloudflare Tunnel HTTPS
- [ ] iPhone 實機測試

**Exit criteria：** 在 iPhone Safari 真機，講一句中英混合，3 秒內 textarea 出乾淨文字，可以 copy。

---

## Phase 2 — PWA 打磨（變得好用）

- [ ] PWA manifest + Add to Home Screen + icon + splash
- [ ] Cleanup 模式：訊息 / Email / TODO / Prompt
- [ ] 語言模式：繁中 / 英文 / 中英混合 / 粵語口語 → 書面
- [ ] 即時 partial vs committed transcript 分離（避免跳動）
- [ ] History（本地）、prompt presets / favorites
- [ ] Auto-copy after cleanup、震動回饋、cancel gesture（上滑取消）
- [ ] Raw transcript toggle / undo（讓用戶信任 cleanup）

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

- [ ] 評估 keyboard extension mic 限制的最新狀態
- [ ] 復用 PWA 的後端引擎（token + cleanup）
- [ ] Keyboard extension → backend → Gemini
- [ ] `textDocumentProxy.insertText` 插字到任何 app

**Exit criteria：** 在 Telegram / Notes 任何輸入框，按 mic 就能語音輸入。
