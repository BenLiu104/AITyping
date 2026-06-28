# ADR 0001 — 初始架構決策

> 狀態：Accepted · 日期：2026-06-26
> ADR (Architecture Decision Record) 紀錄「為什麼這樣選」，讓 AI agent 與未來的自己不再重複爭論已定的事。

## 背景
要做一個 iPhone 上的智能語音輸入工具。經過 5 個 session 的可行性研究（見 `brainstorm/`），下列決策已定。

---

## 決策 1：先做 PWA，不做 native keyboard
- **選擇：** Phase 1–3 做 iPhone-first PWA；native iOS keyboard extension 延到 Phase 4 才評估。
- **理由：** Apple 從 OS 層封死 keyboard extension 的 mic 權限（不是 VPS 問題，有 Mac 也做不到即時麥克風）。PWA 可在 VPS-only 環境快速驗證核心引擎。
- **取捨：** PWA 不能把文字貼到其他 app，只能貼回自己 textarea + 一鍵 copy。接受。

## 決策 2：AudioWorklet，不用 MediaRecorder
- **選擇：** 用 Web Audio API + AudioWorklet 取 raw PCM。
- **理由：** Gemini Live API 要 16kHz / 16-bit little-endian PCM。MediaRecorder 在 iOS Safari 產出 AAC/MP4，需額外 transcode、增加延遲與複雜度。
- **取捨：** AudioWorklet + 手動 resample 較硬核，但格式最乾淨、延遲最低。

## 決策 3：ephemeral token，API key 留後端
- **選擇：** 後端用真 `GEMINI_API_KEY` 簽發短效 token；瀏覽器拿 token 直連 Gemini Live。
- **理由：** 前端任何人都能開 DevTools 看到 key。token 短效 + audio 直連 Gemini 既安全又低延遲，VPS 不需中轉音訊流。
- **取捨：** 多一個 `/api/live-token` 端點與 token 生命週期管理。值得。

## 決策 4：後端用 FastAPI (Python)
- **選擇：** FastAPI + uvicorn + `google-genai` + pydantic v2。
- **理由：** 與既有 Python 工作流一致；async / WebSocket 支援好；pydantic 做 schema 驗證。
- **取捨：** 前後端不同語言（TS / Python），但兩邊各取所長，且後端只是輕量 token + cleanup proxy。

## 決策 5：前端用 Vite + React + TypeScript
- **選擇：** Vite + React 18 + TS strict + vite-plugin-pwa。
- **理由：** AI agent 對 React 最熟、生態成熟、Vite HMR 快、PWA 支援好。
- **取捨：** 單頁應用其實 vanilla/Svelte 也夠，但 React 換來 agent 開發流暢度與可維護性。

## 決策 6：Gemini 呼叫一律經 adapter 層
- **選擇：** 所有 Gemini SDK 呼叫集中在 `backend/app/gemini/`，model 名放 config。
- **理由：** Live API 仍是 preview，model 名與 API 會變。adapter 隔離變動，改一處即可。

## 決策 7：部署在 VPS + Docker + Cloudflare Tunnel
- **選擇：** VPS (161.153.57.166, ARM64) + Docker + Cloudflare Tunnel 反向代理。
- **理由：** `getUserMedia` 需要 HTTPS。你已經明確指定並採用 Cloudflare Tunnel 方案（透過域名 `https://aityping.bochibb.qzz.io` 入 VPS），這樣 VPS 就不需要向外網曝露 80 或 443 埠口，安全性更高，且能享受 Cloudflare 提供的免費安全防護。
- **配置詳情：** 域名 `https://aityping.bochibb.qzz.io` 會對應後端 config 中的 CORS Allowed Origins，且 Gemini Live API 的雙向 Web Token 機制也在此安全域名下進行。
- **模型選定：**
  - **Live API 模型**：`models/gemini-3.1-flash-live-preview` (Gemini Live API)
  - **Cleanup 整理模型**：`gemini-3.1-flash-lite` (FastAPI 後端調用)
