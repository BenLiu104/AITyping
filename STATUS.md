# 📍 當前狀態 — AITyping

> agent resume 時第一份要讀的檔案。單頁、簡潔、只記當下。

## 當前階段

**Phase 0（專案前期準備）— 完成。**

| 項目 | 狀態 | 備註 |
|---|---|---|
| README / Roadmap / AGENTS / PRD | ✅ Done | 4 份核心文件 |
| `.gitignore` / `.env.example` / `.editorconfig` / `CHANGELOG` | ✅ Done | 基礎設施 |
| `docs/adr/0001` 架構決策紀錄 | ✅ Done | 7 項決策 |
| `brainstorm/` 5 個 session 可行性研究 | ✅ Done | 5 個 `Answer_*.md` |
| Git init + first commit (`b636ac8`, branch `main`) | ✅ Done | 14 files tracked |
| `STATUS.md` / `ERRORS.md` / `GATES.md` + `check.sh` | ✅ Done | 框架吸收 |
| `AGENTS.md` 加入路由 + 回退協議 | ✅ Done | 框架吸收 |

**下一階段：Phase 1 — PWA MVP**

## 上次做的事

吸收 VibeCoding 線性框架設計原則：STATUS.md / ERRORS.md / GATES.md + check.sh / 路由 + 回退協議。

## 下一步要做

Phase 1 開發（14 個 task，分 4 Epic — 見 `PRD.md` §10）：
- Epic A：後端引擎（A1–A5）
- Epic B：前端骨架（B1–B6）
- Epic C：Mock / 開發體驗（C1–C2）
- Epic D：部署 + 真機測試（D1–D3）

## 待決事項 (Open)

見 `PRD.md` §14：
- Q1. 域名用 Caddy 定 Cloudflare Tunnel？
- Q2. ephemeral token 用邊個 API 簽？（上線前確認）
- Q3. 確認 Live / cleanup model 現行名
- Q4. partial transcript 顯示策略

## 已知問題 / 坑 (Known Issues)

> 正式錯誤記錄見 `ERRORS.md`。呢度只記短期内要留意、未形成正式 error entry 嘅事項。

- 無。
