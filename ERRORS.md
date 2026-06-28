# ERRORS.md — AITyping 錯誤知識庫

> 作用：記錄已踩過的坑，避免新 session / 新 agent 重複犯錯。
> 只放「症狀 → 根因 → 解法 → 預防」。當前狀態見 `STATUS.md`；產品變更歷史見 `CHANGELOG.md`。

| 時間 | 症狀 | 根因 | 解法 | 預防 |
|---|---|---|---|---|
| 2026-06-27 22:00 | Nginx 靜態站對 `/api/` POST 回 405 | frontend Nginx 未配置 API reverse proxy，POST 被當作靜態資源處理 | 在 `nginx.conf` 新增 `location /api/`，proxy 到 `backend:8000` | 部署 frontend 時檢查 API route proxy，不只測 index.html |
| 2026-06-27 22:04 | `pcm-processor.js` 載入 403 | host file permission 是 `600`，nginx container 無法讀取 | `chmod 644 frontend/public/pcm-processor.js` 後 rebuild/redeploy | 新增 public/worklet asset 時確認權限至少 `644` |
| 2026-06-27 22:10 | `/api/live-token` 回 501 / 404 | Google AI Studio API key 不支援 `create_web_token`；SDK 亦無可用簽發方法 | backend adapter 加 direct API key fallback，由 `/api/live-token` 回傳 Live 連線設定 | Live token path 必須保留 direct-key fallback；不要假設 web token API 可用 |
| 2026-06-27 22:53 | Production UI 退化成裸 HTML | 使用 Tailwind utility class，但 Tailwind 未安裝/未接入 Vite | 安裝 `tailwindcss` / `@tailwindcss/vite`，`index.css` import Tailwind | build 後確認 CSS bundle 不是極小值；必要時用 browser 檢查 computed style |
| 2026-06-27 22:53 | Settings checkbox / options 點不到 | 偽 switch button + label/span pointer interception | 改為原生 checkbox input 覆蓋 switch，decorative spans 加 `pointer-events-none` | 互動元件用 native input + accessibility role，並實測 click |
| 2026-06-27 22:53 | Mic 只走 mock / 不請求真 mic | `mockMode` 預設 true；真流程又先 await token 再 `getUserMedia` | mock 預設 false；真流程先 `getUserMedia()`，成功後才取 token | iOS mic permission 必須在 user gesture 內第一時間請求 |
| 2026-06-27 23:45 | Public URL 間歇 502 | 同一 tunnel 同時跑 host systemd connector + Docker connector；Docker 內 `localhost:8080` 指錯 namespace | 改行 Option A：移除 Docker tunnel service，只保留 host `cloudflared.service` | 不要同一 tunnel token 多 connector 混用；Dashboard ingress 指 `localhost:*` 時用 host connector |
| 2026-06-28 00:06 | Mic 有錄但無 Live transcript / cleanup 空 | Live setup 用 unsupported `TEXT` modality；未啟用 `inputAudioTranscription`；parser 沒讀 `serverContent.inputTranscription.text` | 改 `v1beta` direct WS、`responseModalities: ['AUDIO']`、`inputAudioTranscription: {}`、parse input transcription；release 送 `audioStreamEnd` | Gemini Live input transcription 需要 AUDIO modality + input transcription + 正確 parser |
| 2026-06-28 01:41 | iOS 首次 mic permission 後 recording state 卡住 | permission prompt 打斷 touch sequence；app 在授權前已設 `isRecording=true` | 第一次點 Mic 只做 permission priming，立即 stop tracks，不取 token、不進 recording | iOS 首次 permission prompt 不可當作正式錄音 gesture |
| 2026-06-28 01:55 | PWA 看不到新 Live transcript 行為 / cleanup 假陽性 | 舊 Service Worker 可能仍控制頁面；狀態文字被放入 transcript state | app entry 加 `registerSW({ immediate: true })`；分離 `liveStatus` 與 transcript state；無 true transcript 不 cleanup | PWA update 要 register/claim；status text 不得混入 transcript |
| 2026-06-28 02:13 | iOS mic permission 問題回歸 | localStorage 被當作 permission truth，但 iOS 可能重新 prompt | 移除 localStorage gating；每個 page session 第一 tap 必定只 prime | 不要用 localStorage 判斷 browser permission 真實狀態 |
| 2026-06-28 02:25 | `v02:10` 已更新但 iPhone 仍無 transcript | WebSocket open 不等於 Gemini setup ready；pre-setup buffer 太短，短句開頭易丟 | 增加 `onSetupComplete`；setupComplete 前 buffer 擴到約 5 秒；UI 只在 setupComplete 後提示可說話 | Live audio send/readiness 以 setupComplete 為準，不以 socket open 為準 |
| 2026-06-28 02:48 | Debug 顯示 `ws=1 setup=0 chunks>0 sent=0 tx=0` | Browser WebSocket 可能把 Google Live response 交付成 `Blob`；舊 code 直接 `JSON.parse(event.data)` | LiveClient 先 normalize `string` / `Blob` / `ArrayBuffer` 成 text 再 parse；加 Blob setupComplete regression test | WS client 不可假設 `event.data` 一定是 string |
| 2026-06-28 02:48 | 停止後 debug bytes 仍短暫上升 | AudioWorklet late messages 可能在 disconnect/close 後抵達 | cleanup 時先設 `isCaptureActiveRef=false`、清 port handler；late message 直接 ignore | stop path 要有 synchronous capture gate，不能只靠 async disconnect |
| 2026-06-28 09:19 | Home Screen PWA 已成功 transcript 但仍顯示 WS error | PWA teardown/release 後可能觸發 late `onerror`/1006；原本一律顯示 user-facing error | 若已有 transcript 或 transcript event，WS error 只送 debug telemetry，不 `setErrorMsg`、不中斷 cleanup | 有 transcript 後的 WS error 當 telemetry；不要覆蓋成功流程 |
