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
- 目標環境：VPS `<VPS_IP>`（Ubuntu 24.04 **ARM64** + Docker）

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

## 11. 狀態路由（Agent Resume 流程）

> 每次新對話 / 新 session 開工時，按此流程恢復工作。

```text
[新對話開始]
    │
    ├─ 1. 讀 STATUS.md      ← 確認當前階段、上次做咗咩、下一步
    │
    ├─ 2. 讀 ERRORS.md      ← 如有紀錄，避免重複踩已知坑
    │
    ├─ 3. 確認工作目標：
    │     ├─ 跟 STATUS.md 的「下一步要做」
    │     └─ 或用戶即時指示 > 文件
    │
    ├─ 4. 讀 AGENTS.md §1 黃金規則  ← 每次確認
    │
    ├─ 5. 根據任務讀對應文件：
    │     ├─ 要 build / 驗收 → PRD.md
    │     ├─ 要理解決策原因 → docs/adr/
    │     ├─ 要 check 閘門 → GATES.md + 跑 bash check.sh
    │     └─ 要查 iOS 坑 → PRD.md §12
    │
    └─ 6. 開始工作
```

## 12. 工作流程路由（Routing Table）

| 當前步驟 | 需要讀的檔案 | 輸出 / 下一步 |
|---|---|---|
| 規劃（Phase 0） | `README` + `PRD` + `docs/adr/` | `STATUS.md` 更新、`Roadmap.md` 更新 |
| 開發（Phase 1–3） | `PRD.md` §10（對應 Epic）+ `AGENTS.md` §1 | frontend/ 或 backend/ 的代碼 |
| 驗收 | `GATES.md` + `bash check.sh` | 閘門結果；未過 → 退回對應步驟 |
| 接續工作 | `STATUS.md` + `ERRORS.md` + 路由表 | 繼續開發 |
| 重構 / bug fix | `ERRORS.md` + `docs/adr/` + `PRD.md` | fix → update STATUS + check.sh |

## 13. 約束衝突回退協議

當開發中發現約束衝突，**不要繞過它**。退回衝突涉及的最早步驟：

```text
發現交互設計超出技術邊界
  → 退回步驟「項目框架」（退回重新確認技術方案）

發現技術約束影響產品範圍
  → 退回步驟「PRD 規劃」（退回重新確認產品範圍）

發現安全規則被違反（API key 出現、secret 被 commit 等）
  → 立即停止、修復、review 全部 affected files
```

**規則：**
1. 衝突必須用一句話明確標註（例如：「Live API 不支援 48kHz 輸入，需要前端 resample」）。
2. 標註後由用戶確認，才能繼續。
3. 不能因為「趕進度」而繞過衝突。
4. 修復後更新 docs / ADR / ERRORS，確保下次唔會再踩。

## 14. 閘門驗證（Gate Verification）

- 每個 Phase 的完成標準定義在 `GATES.md`。
- 完成一個 Phase 前必須跑 `bash check.sh`（自動 + 手動閘門全部通過）。
- 閘門未過 = Phase 未完成 = 唔可以跳下一步。
- 閘門失敗時記錄到 `ERRORS.md` 然後修復，唔好直接 mark done。

## 15. 文件更新規則（幾時寫 / 幾時更新）

> 路由表教「幾時讀」。呢份教「幾時寫」。agent 改咗嘢但唔更新文件 = 冇完成。

| 文件 | 幾時更新 | 更新什麼 | 誰負責 |
|---|---|---|---|
| **STATUS.md** | Phase 轉換時 / 下一步變更時 / 重要進度里程碑 / session 結束前 | **Resume dashboard**：Current Focus、Current Product Behavior、Area Status、Verification Snapshot、High-Signal Pitfalls、Next Steps；只保留當前要接手的資訊 | agent（每次狀態變更後） |
| **ERRORS.md** | 遇到新 error 時 / 修復舊 error 時 / 發現可重複踩坑的根因時 | **錯誤知識庫**：症狀、根因、解法、預防。只記 debug knowledge，不放 roadmap / 當前下一步 / changelog 摘要 | agent（開發者） |
| **CHANGELOG.md** | 每個 feature / fix / refactor 完成並準備 commit/merge 前；或發現之前漏記的重要變更時 | **產品/架構變更紀錄**：按 Keep a Changelog 追加 Added / Changed / Fixed / Security 等；只寫 user-visible 或 architecture-level 變更，不寫 debug 流水帳 | agent（commit 前） |
| **PRD.md** | API 合約變更時 / scope 增減時 / NFR 變更時 | §6 API 合約、§3 FR、§4 NFR、§14 Open Questions | agent + user confirm |
| **GATES.md** | 閘門通過 / 失敗時 / 新 Phase 閘門定義時 | 狀態欄更新；或新增閘門條目 | agent（開發者） |
| **check.sh** | 新增 / 修改閘門邏輯時 | 相應的 shell check 函數 | agent（開發者） |
| **AGENTS.md** | 黃金規則變更時（少改） | §1 黃金規則、§5 程式碼規範等 | agent + user confirm |
| **docs/adr/** | 架構決策有變或被推翻時 | 新增 ADR（直接 append，不修改已 accepted 的 ADR） | agent + user confirm |
| **.env.example** | 新增環境變數時 | 加入對應 key + 假值註解 | agent（開發者） |
| **README.md** | 技術棧 / 架構 / 用法有重大變更時 | 對應段落更新 | agent + user confirm |
| **Roadmap.md** | Phase 完成 / 路線規劃變更時 | 更新 task checklist；或修改階段描述 | agent + user confirm |

**核心原則：**
1. **改 code 唔改文件 = 唔算完成。** Definition of Done 包括更新相關文件。
2. **三份文件唔好互相複製：**
   - `STATUS.md` = resume dashboard，只講現在狀態、當前行為、驗證 snapshot、下一步。
   - `ERRORS.md` = 錯誤知識庫，只講症狀 / 根因 / 解法 / 預防。
   - `CHANGELOG.md` = 對外/專案層面的產品與架構變更，只講 feature / fix / change / security。
3. **STATUS.md 係最易漏嘅。** 每次 session 結束前更新 Current Focus、Verification Snapshot、Next Steps；不要把整份 `ERRORS.md` 或完整 changelog 摘入去。
4. **ERRORS.md 係最低成本嘅高回報文件。** 踩坑當下記低症狀、根因、解法、預防；若只係產品功能變更，放 `CHANGELOG.md`，唔好放 `ERRORS.md`。
5. **CHANGELOG.md 係 commit/merge 前必查。** 每個 feature / fix / refactor 完成後，補 Added / Changed / Fixed / Security；不要寫 `setup=0 sent=0` 呢類 debug counter，細節放 `ERRORS.md`。
6. **user confirm required 嘅文件**（PRD、ADR、AGENTS golden rules）agent 唔可以自己靜雞雞改，要先話畀 user 聽；本節文件規則如 user 要求整理，可直接更新並驗證。
7. **文件過時 = 引導 agent 做錯決定。** 如果發現呢份文件更新規則本身 outdated，第一時間 update 佢。

## 16. 不確定就查哪裡

- 要 build 什麼、流程怎麼走 → `PRD.md`
- 架構決策為什麼這樣選 → `docs/adr/`
- API 合約 → `PRD.md` §6
- iOS Safari 坑 → `PRD.md` §12
- 當前進度、下一步 → `STATUS.md`
- 已知錯誤 → `ERRORS.md`
- 驗收閘門 → `GATES.md` + `bash check.sh`
- 文件更新規則 → `AGENTS.md` §15
