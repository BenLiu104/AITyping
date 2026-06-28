# GATES.md — 驗收閘門

> 每個 Phase 的完成標準，定義為可執行檢查。對應 `check.sh`。
>
> 一個 Phase 只有全部閘門通過，才算真正完成。

---

## Phase 0 — 專案前期準備（全部 ✅）

| ID | 閘門 | 檢查方式 | 狀態 |
|---|---|---|---|
| G0.1 | 14 個核心檔案存在且非空 | `check.sh phase0` | ✅ |
| G0.2 | Git repo 初始化、branch=main、有 commit | `check.sh phase0` | ✅ |
| G0.3 | `.env` 不被 git 追蹤 | `check.sh phase0` | ✅ |
| G0.4 | Tracked 內容無真 API key 模式 | `check.sh phase0` | ✅ |
| G0.5 | 核心 docs code fence 平衡 | `check.sh phase0` | ✅ |
| G0.6 | AGENTS 有完整路由 + 回退協議 + 更新規則 | `check.sh phase0` | ✅ |
| G0.7 | STATUS.md 反映當前階段 | 人工確認 | ✅ |

---

## Phase 1 — PWA MVP（✅ 基本流程已通過 v09:23）

| ID | 閘門 | 檢查方式 |
|---|---|---|
| G1.1 | `frontend/`、`backend/` 目錄存在，package.json / pyproject.toml 可 install | `check.sh phase1` |
| G1.2 | `npm run typecheck` 無錯 | `check.sh phase1` |
| G1.3 | `ruff check . && ruff format . --check` 通過 | `check.sh phase1` |
| G1.4 | `npm run test` + `pytest` 全綠 | `check.sh phase1` |
| G1.5 | DevTools / bundle 中無 `GEMINI_API_KEY` | `check.sh phase1`（grep dist/） |
| G1.6 | Mock 模式可獨立運作（`MOCK_MODE=true` 不需 Gemini） | `bash test/mock_test.sh` |
| G1.7 | iPhone Safari / Home Screen PWA：tap-to-toggle 後 Live transcript 出現 | 手動測試：`v09:23` Ben confirmed ✅ |
| G1.8 | 停止錄音後 < 3s 出 cleanup 文字 | 手動測試：`v09:23` Ben confirmed ✅ |
| G1.9 | 一鍵 copy 成功 | 手動測試 |
| G1.10 | 成功 transcript/cleanup 後不再顯示 false-positive WebSocket error | 手動測試：`v09:23` Ben confirmed ✅ |

---

## Phase 2 — PWA 打磨（🎯 Current）

| ID | 閘門 | 檢查方式 |
|---|---|---|
| G2.1 | PWA manifest + service worker installable | Lighthouse audit |
| G2.2 | 4 種 cleanup mode 全部可選 + 正確輸出 | 手動測試 |
| G2.3 | 語言模式切換正常 | 手動測試 |
| G2.4 | History 存取 + 清除 | 手動測試 |
| G2.5 | Raw transcript toggle 可切換 | 手動測試 |
| G2.6 | Debug counters 隱藏或只在 debug mode 顯示 | 手動測試 |
| G2.7 | Cancel flow 可中止當前錄音 / cleanup | 手動測試 |

---

## Phase 3 — 穩定性與安全

| ID | 閘門 | 檢查方式 |
|---|---|---|
| G3.1 | Rate limiting 生效 | `ab` 或 `curl` 壓測 |
| G3.2 | Token endpoint 有 auth（或 IP whitelist） | 手動測試 |
| G3.3 | WS 斷線重連 + local buffer 不遺失 transcript | 模擬斷線測試 |
| G3.4 | 無 API key、無 HTTPS、無 mic 權限等錯誤狀態有 UX | 手動測試 |

---

## Phase 4 — Native iOS Keyboard Extension

| ID | 閘門 | 檢查方式 |
|---|---|---|
| G4.1 | Keyboard extension 可安裝到 iOS 裝置 | Xcode build |
| G4.2 | 可在任意 text field 觸發語音輸入 | 手動測試 |
| G4.3 | 後端引擎復用（token + cleanup） | code review |
