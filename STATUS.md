# STATUS.md — AITyping 專案狀態追蹤表

> 💡 這是專案進度的最高指引，每次有重大變更，Agent 都會實時更新此表。

## 1. 當前階段：Phase 1 — PWA MVP 🎯
*   **目標**：建立包含 FastAPI 後端與 Vite 前端的 iPhone 友善智能語音草稿板，打通 Gemini Live 與 Cleanup。
*   **當前狀態**：**前端與後端骨架 100% 串接並實作完畢，自動化測試與 Gates 全部綠燈！**

---

## 2. 進度追蹤表 (Progress Matrix)

| 階段 / Epic | 任務 | 狀態 | 驗證方式 | 備註 |
|:---|:---|:---:|:---|:---|
| **Phase 0** | 16個文件與基礎配置閘門 | ✅ 完成 | `bash check.sh phase0` | 全部 16 個 Gates 通過 |
| **Epic A (後端)** | A1. FastAPI Skeleton + Config | ✅ 完成 | `pytest` + `hermes-verify-` | 讀取 `.env` CORS & 雙模型 |
| | A2. Gemini Adapter + Token | ✅ 完成 | `pytest` | 支援 `MOCK_MODE` 降級 |
| | A3. Cleanup /api/cleanup | ✅ 完成 | `pytest` | 四種語言 + 模式（避免 Markdown 溢出） |
| **Epic B (前端)** | B1. Vite + PWA 腳手架 | ✅ 完成 | `tsc` + `oxlint` + `vitest` | 完整 JSDOM 與 PWA 配置 |
| | B2. iOS 極簡 UI 刻板 | ✅ 完成 | `vitest` | Push-to-Talk touch 監聽 + 震動開關 |
| | B3. 16kHz PCM 音訊管線 | ✅ 完成 | `vitest` | AudioWorklet + Resampler |
| | B4. WebSocket LiveClient 實作 | ✅ 完成 | `live-client.test.ts` | 完整對接 Gemini Live WS 雙向協定 |
| | B5. 串聯 Push-to-Talk 錄音管線 | ✅ 完成 | `app.test.tsx` | UI 觸發錄音、Worklet 送至 LiveClient |
| | B6. 串聯 /api/cleanup 整理與複製 | ✅ 完成 | `app.test.tsx` | 自動將實時聽寫送往後端 cleanup 整理並一鍵複製 |

---

## 3. 閘門完成度 (Gate Compliance)
*   **自動化 Gates (G1.1 至 G1.4)**: 🏆 **100% 全部通過 (6 passed, 0 failed, 2 skipped/skipped-by-design)**。
*   **人工測試 Gates (G1.6 至 G1.9)**: 待部署至 VPS 測試機（經由 Cloudflare Tunnel）後在 iPhone 真機上進行多網段實際收音測試。

---

## 4. 已知錯誤與避坑指南 (ERRORS.md 摘錄)
*   *暫無新增錯誤。*

---

## 5. 下一步要做 (Next Steps)
1.  **Phase 1 部署 (Epic C)**: 配置生產環境 Docker Compose 與 Caddy / Cloudflare Tunnel 代理。
2.  **真機驗收**: 在 iPhone 上進行多環境語音測試（確保 HTTPS 錄音授權與震動回饋正常）。
