# AGENTS.md — AITyping 開發規則（AI Agent 必讀）

> 這份是給 AI coding agent（Codex / Claude / OpenCode 等）的最高指引。**開工前必讀。** 配合 `PRD.md`（要 build 什麼、怎麼 build）一起用。
> **衝突優先序：** 使用者即時指示 > `AGENTS.md` > `PRD.md`。

## 0. 一句話專案脈絡

AITyping 是一個 iPhone-first PWA 智能語音輸入：按住說話 → Gemini Live API 即時聽寫 → 放開 → `gemini-3.1-flash-lite` 整理 → 貼回 textarea → 複製。詳見 `README.md` / `PRD.md`。

## 1. 黃金規則（違反 = 直接 reject）

1. **API key 永不出現在前端 code、bundle、git。** 真 `GEMINI_API_KEY` 只在後端 `.env`（已 gitignore）。前端只用後端 `/api/live-token` 簽發的 **ephemeral token**。
2. **不 commit 任何 secret** — `.env`、token、憑證一律不入 git。要新環境變數先更新 `.env.example`（用假值）。
3. **音訊用 AudioWorklet，不用 MediaRecorder。** Live API 要 raw 16kHz / 16-bit little-endian PCM。MediaRecorder 在 iOS Safari 出 AAC/MP4，不行。
4. **所有 Gemini 呼叫經過 adapter 層**（`backend/app/gemini/`）。不要在 route handler 直接散落 SDK 呼叫 — model 名 / API 會變。
5. **不假設背景收音。** 設計成 push-to-talk 前景使用。
6. **不嘗試把文字貼到其他 app。** Web app 只能操作自己頁面的 DOM / clipboard。
7. **HTTPS 是前提。** 不寫依賴 http 明文的 getUserMedia 流程。
8. **小範圍改動。** 一個 PR / commit 做一件事，對應 PRD 的一個 task。不順手大重構。

## 2. 專案結構（東西要放對位）

```
AITyping/
├── docs/                  # 設計、ADR；不放 code
├── brainstorm/            # 前期可行性研究（唯讀參考）
├── frontend/              # Vite + React + TS（Phase 1 建立）
│   ├── src/
│   │   ├── audio/         # AudioWorklet、PCM 轉換、resample
│   │   ├── live/          # Gemini Live WebSocket client
│   │   ├── ui/            # components
│   │   └── lib/           # 共用工具
│   └── public/            # PWA manifest、icons、worklet processor
└── backend/               # FastAPI（Phase 1 建立）
    └── app/
        ├── main.py        # app entry、route 註冊
        ├── routes/        # /api/live-token、/api/cleanup
        ├── gemini/        # ★ Gemini adapter（token、cleanup）
        └── core/          # config、CORS、errors、rate limit
```

## 3. 技術棧 + 版本

- 前端：Vite 5+、React 18+、TypeScript 5+（`strict: true`）、vite-plugin-pwa
- 後端：Python 3.11+、FastAPI、uvicorn、`google-genai` SDK、pydantic v2
- 套件管理：前端 `npm`；後端 `uv`
- 部署：Docker + docker-compose、Caddy（自動 HTTPS）或 Cloudflare Tunnel
- 目標環境：VPS 161.153.57.166（Ubuntu 24.04 **ARM64** + Docker）

> ⚠️ ARM64：base image 要選 arm64 相容（官方 multi-arch image OK）。

## 4. 指令（agent 用這些，不要自創）

```bash
# 前端
cd frontend
npm install
npm run dev          # 本地 dev server
npm run build        # production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run test         # Vitest

# 後端
cd backend
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt
uvicorn app.main:app --reload   # dev
ruff check . && ruff format .   # lint + format
pytest                          # tests
```

> 若 `frontend/` 或 `backend/` 還不存在，照 `PRD.md` §10 的步驟先 scaffold。

## 5. 程式碼規範

- TypeScript：`strict` 全開，不用 `any`（必要時 `unknown` + narrow）。
- React：function components + hooks，不用 class component。
- Python：type hints 必須、pydantic model 做 request/response、`ruff` 做 lint+format。
- 命名：前端檔案 `kebab-case`；後端 Python `snake_case`。
- 不為了小事引入重型 dependency（例如整個 UI library 只為一顆 button）。先問值不值。
- 所有對外 I/O（網路、mic、API）要有 error handling，不靜默吞錯。

## 6. Git / Commit 規範

- **Conventional Commits**：`feat:`、`fix:`、`docs:`、`refactor:`、`chore:`、`test:`。
- 一個 commit 一件事，message 說明「做了什麼 + 為什麼」。
- Branch：`main` 穩定；feature 用 `feat/<short-name>`。
- 不 force push (`--force`) 到 `main`。

## 7. 完成定義 (Definition of Done)

一個 task 才算完成，當：
- [ ] 功能對得上 `PRD.md` 的 acceptance criteria
- [ ] `typecheck` / `lint` / `test` 全綠
- [ ] 沒有 secret 進 code / git
- [ ] （影響 UI / 流程）在 iPhone Safari 真機跑過一次
- [ ] 必要時更新了 `README` / `docs` / `CHANGELOG`

## 8. 測試要求

- 純函數（PCM 轉換、resample、cleanup prompt builder）必須有 unit test。
- 後端 route 用 FastAPI TestClient 測 happy path + 主要 error。
- 不追求 100% coverage，但核心 audio pipeline 與 API 合約一定要有 test。

## 9. 安全清單（每個 PR 自檢）

- [ ] 沒有 hardcode key / token
- [ ] ephemeral token 有 expiry，不發長效
- [ ] CORS 只開給自己 domain
- [ ] 後端有 input validation（pydantic）
- [ ] 用戶數據（語音、transcript）不無謂落 log / 落 disk

## 10. 不要做（常見錯誤）

- ❌ 用 MediaRecorder 收音
- ❌ 前端 fetch 直接帶 `GEMINI_API_KEY`
- ❌ 假設可以背景錄音 / 貼到其他 app
- ❌ 在 route handler 直接 call SDK（要經 adapter）
- ❌ 為一顆 button 裝整個 component library
- ❌ 一個 PR 又做 feature 又大重構
- ❌ 改了 API 合約但不更新 `PRD.md`

## 11. 不確定就查哪裡

- 要 build 什麼、流程怎麼走 → `PRD.md`
- 架構決策為什麼這樣選 → `docs/adr/`
- API 合約 → `PRD.md` §6
- iOS Safari 坑 → `PRD.md` §12
