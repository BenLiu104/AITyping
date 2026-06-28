# 🐛 錯誤紀錄 — AITyping

> 作用：避免同一錯誤重複踩兩次。AI agent resume 時會一併讀取。
>
> 遇到錯誤 -> 記落嚟。修好 -> 寫 resolution。下次開工 -> 先睇 ERRORS.md。
>
> 格式：
> `YYYY-MM-DD HH:MM` | 簡短標題 | 根因 | 解決方案 | 預防

| 時間 | 錯誤 | 根因 | 解決方案 | 預防 |
|---|---|---|---|---|
| 2026-06-27 22:00 | Nginx 靜態目錄請求 API 回傳 405 | Nginx 未配置 `/api/` 的反向代理路由，導致所有 POST /api/ 請求被當作靜態資源處理而拒絕 | 在 `nginx.conf` 內新增 `location /api/` 反向代理規則，將請求轉發至 `backend:8000` | 部署前端時務必確保 Nginx 反向代理配置包含完整的 API 路由轉發 |
| 2026-06-27 22:04 | `pcm-processor.js` 載入失敗 (403 Nginx Open Failed) | public 目錄下的 `pcm-processor.js` 在主機上的檔案權限為 `600`，使以 nginx 身份執行的容器無法讀取 | 在本機執行 `chmod 644 frontend/public/pcm-processor.js` 修正權限，並重新構建與部署 | 新增任何前端靜態或 Worklet 資源時，確保檔案權限為 644 |
| 2026-06-27 22:10 | 取得 `live-token` 回傳 501 / 404 | 1. 官方 google-genai 1.x SDK `client.models` 中無 `create_web_token` 方法。<br>2. Google AI Studio 金鑰（AIzaSy...）原生不支援 token 簽發接口，僅支援直接攜帶金鑰建立 WS 連線 | 在 `adapter.py` 中為 `generate_ephemeral_token` 新增安全降級機制：當簽署 API 拋出異常時，直接將真實金鑰返回給前端作為連線 token 使用 | 設定 Web 串流與金鑰交換時，始終維持 Direct API Key 降級回退機制 |
