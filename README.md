# AITyping — 智能語音輸入 (AI Voice Input PWA)

> 對著 iPhone 講話，AI 即時轉文字、自動整理乾淨，一鍵複製貼上。

## 這是什麼

AITyping 是一個 **iPhone-first 的 PWA（漸進式網頁應用）**，做「智能語音輸入草稿板」：

> 按住麥克風 → 講話 → Gemini Live API 即時聽寫 → 放開 → `gemini-3.1-flash-lite` 整理成乾淨文字 → 出現在 textarea → 一鍵複製。

**核心價值不是「轉寫」，而是「講得亂，出來很乾淨」。**

## 這不是什麼

- ❌ **不是** iOS 系統輸入法 / 第三方鍵盤 — web app 沒有權限把文字貼到其他 app（WhatsApp / Notes…）。這是 iOS 安全模型限制，不是技術不夠。
- ❌ 不是背景長時間錄音工具 — iOS Safari 退到背景會中斷收音，所以採用 push-to-talk（按住說話）前景使用。

> 想要「任何 app 都能語音輸入」最終要做 native keyboard extension（見 `Roadmap.md` Phase 4）。但 Apple 從 OS 層封死了 keyboard extension 的 mic 權限，所以這是長期、高風險路線，不是 MVP。

## 核心流程

```
按住 mic
  → 建立 Gemini Live API session（用 ephemeral token，不暴露 API key）
  → AudioWorklet 取 PCM、resample 到 16kHz / 16-bit
  → WebSocket 串流送 Gemini
  → 收 inputAudioTranscription，即時顯示草稿
放開 mic
  → 停止收音、flush session
  → transcript 送後端 /api/cleanup
  → gemini-3.1-flash-lite 整理（修錯字、去停頓詞、補標點、保留原意）
  → 結果貼回 textarea
  → 一鍵 copy / share
```

## 技術棧

| 層 | 選擇 | 備註 |
|---|---|---|
| 前端 | Vite + React + TypeScript (strict) | PWA via `vite-plugin-pwa` |
| 音訊 | Web Audio API + **AudioWorklet** | **不用** MediaRecorder（避免 AAC/MP4） |
| 即時聽寫 | Gemini Live API (WebSocket) | `inputAudioTranscription` |
| 文字整理 | `gemini-3.1-flash-lite` (REST) | 後端呼叫 |
| 後端 | FastAPI (Python 3.11+) | `/api/live-token`、`/api/cleanup` |
| 部署 | VPS + Docker + Caddy（自動 HTTPS） | 或 Cloudflare Tunnel |
| 密鑰 | ephemeral token；真 key 只在後端 `.env` | 前端永不接觸 API key |

> 技術棧為預設建議，可調整。詳見 `AGENTS.md` 與 `docs/adr/`。

## 專案結構

```
AITyping/
├── README.md          ← 你正在看
├── Roadmap.md         ← 階段開發路線圖
├── AGENTS.md          ← AI agent 開發規則（agent 必讀）
├── PRD.md             ← 產品需求 + 詳細開發步驟
├── CHANGELOG.md       ← 變更紀錄
├── .gitignore
├── .env.example       ← 環境變數範本（複製成 .env，勿提交）
├── .editorconfig
├── docs/
│   └── adr/           ← 架構決策紀錄 (Architecture Decision Records)
├── brainstorm/        ← 前期 5 個 session 的可行性研究（已存在）
├── frontend/          ← (Phase 1 建立) Vite PWA
└── backend/           ← (Phase 1 建立) FastAPI
```

## 快速開始（Phase 1 後生效）

```bash
# 前端
cd frontend && npm install && npm run dev
# 後端
cd backend && uv venv && source .venv/bin/activate && uv pip install -r requirements.txt && uvicorn app.main:app --reload
```

> iPhone 實機測試需要 HTTPS（`getUserMedia` 限制）。用 Caddy 或 Cloudflare Tunnel 把 VPS 包成 `https://<domain>`。

## 關鍵限制（開發前必讀）

1. **HTTPS 是硬需求** — `getUserMedia()` 只在 secure context 可用。
2. **AudioWorklet 不要用 MediaRecorder** — Live API 要 raw 16kHz PCM16，MediaRecorder 在 iOS 出 AAC/MP4。
3. **API key 永不進前端** — 用後端簽發 ephemeral token。
4. **背景收音不可靠** — 設計成 push-to-talk 前景使用。
5. **只能貼回自己的 textarea** — 不能貼到其他 app。

## 狀態

🚧 Phase 0（專案前期準備）。詳見 `Roadmap.md`。

## 授權

私人專案 (Private)。© 2026 Ben.
