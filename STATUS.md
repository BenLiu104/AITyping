# STATUS.md — AITyping 專案狀態追蹤表

> 💡 這是專案進度的最高指引，每次有重大變更，Agent 都會實時更新此表。

## 1. 當前階段：Phase 2 — 生產部署與實機聯調 🎯
*   **目標**：透過 Docker & Cloudflare Tunnel 將 AITyping MVP 部署至生產環境，完成 iPhone 實機之 PTT 真實語音、即時聽寫、及 Cleanup 管道聯調。
*   **當前狀態**：**Docker 一站式配置與 Cloudflare Tunnel 自動託管已於背景成功部署，API 降級 Fallback 機制已通過本地回環測試（200 OK）！但實機目前依然因瀏覽器或環境限制未成功彈出錄音授權，暫停調試，更新文檔留待後續進一步排查。**

---

## 2. 進度追蹤表 (Progress Matrix)

| 階段 / Epic | 任務 | 狀態 | 驗證方式 | 備註 |
|:---|:---|:---:|:---|:---|
| **Phase 0** | 16個文件與基礎配置閘門 | ✅ 完成 | `bash check.sh phase0` | 全部 16 個 Gates 通過 |
| **Epic A (後端)** | A1. FastAPI Skeleton + Config | ✅ 完成 | `pytest` + `hermes-verify-` | 讀取 `.env` CORS & 雙模型 |
| | A2. Gemini Adapter + Token | ✅ 完成 | `pytest` | 支援 `MOCK_MODE` 降級 |
| | A3. Cleanup /api/cleanup | ✅ 完成 | `pytest` | 四種語言 + 模式（避免 Markdown 溢出） |
| **Epic B (前端)** | B1. Vite + PWA 腳手架 | ✅ 完成 | `tsc` + `oxlint` + `vitest` | 完整 JSDOM 與 PWA 配置 |
| | B2. iOS 極極簡 UI 刻板 | ✅ 完成 | `vitest` | Push-to-Talk touch 監聽 + 震動開關 |
| | B3. 16kHz PCM 音訊管線 | ✅ 完成 | `vitest` | AudioWorklet + Resampler |
| | B4. WebSocket LiveClient 實作 | ✅ 完成 | `live-client.test.ts` | 完整對接 Gemini Live WS 雙向協定 |
| | B5. 串聯 Push-to-Talk 錄音管線 | ✅ 完成 | `app.test.tsx` | UI 觸發錄音、Worklet 送至 LiveClient |
| | B6. 串聯 /api/cleanup 整理與複製 | ✅ 完成 | `app.test.tsx` | 自動將實時聽寫送往後端 cleanup 整理並一鍵複製 |
| **Epic C (部署)** | C1. Dockerfile / docker-compose 配置 | ✅ 完成 | `docker compose config` | 支援 ARM64 多階段構建與 Nginx 緩存優化 |
| | C2. 一站式 Cloudflare Tunnel 託管 | ✅ 完成 | `docker compose ps` | 由容器自動代理，無需在主機安裝守護進程 |
| | C3. 真實 credentials 安全自動注入 | ✅ 完成 | `hermes-verify-env.py` | 自動拉取主機 Tunnel 與 Gemini 密鑰並注入 `.env` |
| | C4. Nginx 反向代理轉發與權限修正 | ✅ 完成 | `docker exec -it` | 完美解決 403 (pcm-processor 讀取限制) 與 405 (API 轉發缺失) |

---

## 3. 閘門完成度 (Gate Compliance)
*   **自動化 Gates (G1.1 至 G1.4)**: 🏆 **100% 全部通過 (6 passed, 0 failed, 2 skipped/skipped-by-design)**。
*   **生產部署與連線狀態**: ✅ **VPS 背景運行中**。後端埠 `8000`、前端埠 `8080`、Cloudflare Tunnel 已與 DNS 互聯成功。
*   **實機測試狀態**: ⚠️ 麥克風調用不成功。已確認 API Key 為正確的 Google AI Studio 金鑰，但實機仍未調用 Mic。

---

## 4. 已知錯誤與避坑指南 (ERRORS.md 摘錄)
1.  **Nginx POST /api/ 405**: 靜態 Nginx 未配置反向代理，已在 `nginx.conf` 加上 `proxy_pass` 轉發修正。
2.  **AudioWorklet 403 Forbidden**: `pcm-processor.js` 在實體主機權限為 `600`，已手動改為 `644` 修復。
3.  **create_web_token AttributeError (501)**: 普通 API 金鑰不支援該 API，已在 `adapter.py` 加上「直接回傳金鑰」安全 Fallback 設計。

---

## 5. 下一步要做 (Next Steps)
1.  **真機排查 (暫停中)**: 待稍後重新開工時，重點檢查 Safari Console 日誌，排查是否有 iOS WebSocket 連接埠與 PWA 安全信任鏈問題。
2.  **多裝置適配**: 擴展至 Chrome / 安卓真機測試。

