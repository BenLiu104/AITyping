# PRD — AITyping 產品需求文件

> 版本 0.2 · 2026-06-28 · 狀態：Phase 1 MVP 基本流程已跑通，進入 Phase 2 polish
> 配合 `AGENTS.md`（怎麼做）。這份講「做什麼、為什麼、做到什麼程度算完成」。

## 1. 產品概述

AITyping 是 iPhone-first 的 PWA 智能語音輸入草稿板。解決：手機打字慢 / 語音輸入轉寫亂（停頓詞、沒標點、中英混雜）。透過 Gemini Live API 即時聽寫 + gemini-3.1-flash-lite 整理，讓用戶「講得隨意，拿到乾淨可用的文字」。

> 2026-06-28 update：MVP 基本流程已在 iPhone / Home Screen PWA `v09:23` 跑通。Mic UX 已由原始 push-to-talk 改為 tap-to-toggle：點一下開始錄音、放手繼續錄、再點一下停止整理。

### 1.1 目標 (Goals)
- **G1**：iPhone Safari / Home Screen PWA 上，tap-to-toggle 錄音並看到 transcript。
- **G2**：停止錄音後 3 秒內出整理好的文字。
- **G3**：支援中 / 英 / 中英混合 / 粵語口語。
- **G4**：一鍵複製，方便貼到其他 app。
- **G5**：VPS-only 開發部署，不需要 Mac。

### 1.2 非目標 (Non-Goals)
- **N1**：不做系統輸入法 / 第三方鍵盤（Phase 4 才評估）。
- **N2**：不做背景 / 長時間錄音。
- **N3**：MVP 不做登入 / 付費 / 多人。
- **N4**：不做自動貼到其他 app。

## 2. 使用者與場景
- 主要用戶：Ben（重度手機文字輸入、中英粵混合）。
- 場景：想到內容 → 開 app → 點 Mic 開始講 → 再點 Mic 停止 → 拿乾淨文字 → 複製到 Telegram / Email / Notes。

## 3. 功能需求 (FR)

| ID | 功能 | 優先級 |
|---|---|---|
| FR1 | tap-to-toggle mic 收音（點一下開始、放手繼續、再點一下停止） | P0 |
| FR2 | AudioWorklet 取 PCM、resample 16kHz/Int16 | P0 |
| FR3 | WebSocket 串流 Gemini Live API | P0 |
| FR4 | 即時顯示 inputAudioTranscription | P0 |
| FR5 | 停止錄音 → cleanup → 貼 textarea | P0 |
| FR6 | 一鍵 copy | P0 |
| FR7 | Mock 模式（不燒 API 開發） | P0 |
| FR8 | Cleanup 模式（訊息/Email/TODO/Prompt） | P1 |
| FR9 | 語言模式 | P1 |
| FR10 | PWA 安裝（Add to Home Screen） | P1 |
| FR11 | History / presets | P2 |
| FR12 | 斷線重連 + buffer | P2 |

## 4. 非功能需求 (NFR)
- **NFR1 延遲**：partial transcript < 500ms；cleanup < 3s。
- **NFR2 安全**：API key 只在後端；Live connection credential/config 由 backend adapter 管理；CORS 鎖 domain。
- **NFR3 相容**：iOS 16+ Safari；HTTPS only。
- **NFR4 可維護**：Gemini 經 adapter；model 名集中在 config。
- **NFR5 成本**：一般用量每月幾塊（Live + flash-lite）。

## 5. 系統架構

```
iPhone Safari (PWA)
  ├─ mic button (tap-to-toggle)
  ├─ AudioWorklet → PCM16 @16kHz
  ├─ Live WS client ──直連──► Gemini Live API（用 backend-issued credential/config）
  └─ textarea ◄── cleanup result
        │ 1) POST /api/live-token       │ 3) POST /api/cleanup
        ▼                               ▼
  Backend (FastAPI @ VPS, Docker, Cloudflare Tunnel HTTPS)
  ├─ POST /api/live-token  → Gemini Live connection credential/config（優先 ephemeral token；fallback direct key config）
  └─ POST /api/cleanup     → gemini-3.1-flash-lite
        │ (持 GEMINI_API_KEY)
        ▼
  Google Gemini API
```

- **Audio 路徑**：iPhone ──直連──► Gemini Live（低延遲，不經 VPS）。
- **Cleanup 路徑**：iPhone ► VPS ► Gemini flash-lite。

## 6. API 合約

### 6.1 `POST /api/live-token`
**Request:** query 參數 `?profile=<english|cantonese|cantonese-english|auto>`（optional，預設通用逐字轉錄；未知值一律 fallback；`?ttl=<秒>` optional）。Phase 3 加 auth。
**Response 200:**
```json
{
  "token": "<ephemeral_token>",
  "expiresAt": "2026-06-26T12:00:00Z",
  "model": "models/gemini-3.1-flash-live-preview"
}
```
- token 短效（≤ 10 分鐘 / 單次 session）；只回傳 backend-created ephemeral token，**不再** fallback 回傳 raw key（見 security fix）。
- ★ **Constrained endpoint 合約**：`v1alpha` `BidiGenerateContentConstrained` WS 會拒絕 client 送出的任何 setup 內容（連空 `{}`）。故完整 setup（`responseModalities` / `inputAudioTranscription` / `systemInstruction`，含依 `profile` 而定的轉錄語言指令）必須在簽發 token 時鎖入 `live_connect_constraints.config`；前端 WS 只送空 `{ setup: {} }` frame 觸發 `setupComplete`。此鎖定邏輯集中在 `backend/app/gemini/adapter.py`，不得散落 route handler。
- 失敗 → fail closed：`503 { "detail": "..." }`（安全訊息，不回顯 SDK error / key）。

### 6.2 `POST /api/cleanup`
**Request:**
```json
{
  "rawTranscript": "string",
  "mode": "message | email | todo | prompt",
  "language": "zh-Hant | en | mixed | yue",
  "style": "natural"
}
```
**Response 200:**
```json
{ "cleaned": "string", "mode": "message" }
```
- 缺 `rawTranscript` → `422`。
- model：`gemini-3.1-flash-lite`。
- `mode` 不含 `semantic`——選 `semantic` 時前端改打 §6.3 `/api/smart-cleanup`，不經此 endpoint。

> 改合約 = 同步更新這裡 + 前後端 + test。

### 6.3 `POST /api/smart-cleanup`（MVP1，semantic mode 專用）
**Request:**
```json
{
  "transcript": "string",
  "languageMode": "zh-Hant | en | mixed | yue"
}
```
**Response 200:**
```json
{
  "clean_text": "string",
  "intent_status": "decided | leaning | comparing | uncertain | note",
  "reasoning_summary": "string",
  "confidence": 0.91
}
```
- 缺 `transcript` 或空字串 → `422`（`min_length=1`）。
- model：`gemini-3.1-flash-lite`，`response_mime_type: application/json` + `response_schema` 約束輸出；解析失敗時 code 端嘗試用 regex 搶救 `clean_text`，完全無法搶救才 `500`。
- 前端只顯示 `clean_text`（寫入現有 cleanup 輸出欄位）；`intent_status` / `reasoning_summary` / `confidence` 保留供 debug / 未來使用，MVP1 UI 不顯示。
- 觸發時機：只喺 stop 錄音、final transcript 非空之後呼叫一次；不處理 interim transcript，不在錄音中呼叫。
- 與 `/api/cleanup` 分離的原因：語義推斷輸出結構（帶 metadata）與純文字整理輸出（string）合約不同；且兩者互斥（`mode` 只能擇一），非並行呼叫。

> 改合約 = 同步更新這裡 + 前後端 + test。

### 6.4 `POST /api/sensevoice-token`（SenseVoice v2 WS 短效簽名 token）

> 狀態：已實作、已部署於 VPS Docker、Ben 已完成真機驗收並核准此 API / 安全設計；HF CPU Docker Space migration 待下一步實作。

**用途：** 瀏覽器無法為 WebSocket 加自訂 header，故 SenseVoice v2 WS（`/ws/transcribe-v2`）改為 token-gated：前端先 `POST /api/sensevoice-token` 取得後端簽發的短效 token，再把 URL-encoded token 以 **query parameter**（`?token=...`）接到 WS URL。

**Request:** 無 body、無 query。

**Response 200:**
```json
{ "token": "<base64url_payload>.<base64url_hmac>", "expiresAt": 1750000000 }
```
- `Cache-Control: no-store`（短效憑證，不快取）。
- `token`：緊湊、URL-safe、**HMAC-SHA256 簽名**的 payload（Python stdlib，不依賴 JWT）。Payload 含 `v`（版本，固定 2）、`aud`（audience，固定字串 `sensevoice-ws-v2`）、`exp`（絕對到期 epoch）、`nonce`（密碼學隨機）。canonical JSON（sorted keys、tight separators）+ unpadded base64url；驗證用 `hmac.compare_digest`。
- `expiresAt`：絕對到期 epoch 秒。

**設定：** 後端與 SenseVoice 共用同一 `SENSEVOICE_WS_TOKEN_SECRET`（兩個 Docker context 各自讀 env，**不互相 import**）；`SENSEVOICE_WS_TOKEN_TTL` 預設 60 秒、有界 5–300。

**失敗：** secret 缺失/無效 → fail closed `503 { "detail": "..." }`（安全訊息，token / secret 一律不落 log / error）。

**SenseVoice 驗證：** v2 WS 在 **log「connection opened」、建立 `StreamingTranscriptionBridge`、載入任何模型之前** 先驗證 query token。無效 / 過期 / 錯 audience / secret 缺失一律 generic error + close（不回顯 token）。

- **互通契約：** 兩端各自實作同一 HMAC 方案，靠 source-controlled 固定測試向量 `contracts/sensevoice_ws_token_vectors.json`（兩邊測試套件都 assert）防止協定漂移。
- **⚠️ 已接受邊界（Ben，2026-07-11）：** 此 task 只保護 `/ws/transcribe-v2`。legacy endpoint（`/transcribe`、`/transcribe_batch`、`/ws/transcribe`）未加 token gate，且 token endpoint 沒有 user auth / rate limit。此風險在目前單人 AITyping HF migration scope 內接受；如擴大公開使用、出現 abuse / 成本或加入多人帳戶，必須先重新設計 access policy、rate limit 及 legacy endpoint。

> 改合約 = 同步更新這裡 + 前後端 + test。

## 7. 音訊管線規格 (Audio Pipeline)
- 取音：`getUserMedia({ audio: { echoCancellation, noiseSuppression, autoGainControl } })`
- AudioContext：Safari 可能不尊重指定 sampleRate（常給 48000）→ **JS 自己 resample 到 16000**。
- 格式：Float32 → Int16 little-endian PCM。
- Chunk：每 100ms 送一次（16000 × 0.1 × 2 = 3200 bytes；base64 ≈ 4.3KB）。
- Float32 → Int16（參考實作）：
```js
function floatTo16BitPCM(f32) {
  const buf = new ArrayBuffer(f32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < f32.length; i++) {
    let s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}
```

## 8. Gemini Live setup message
```json
{
  "setup": {
    "model": "models/gemini-3.1-flash-live-preview",
    "responseModalities": ["AUDIO"],
    "inputAudioTranscription": {},
    "systemInstruction": {
      "parts": [{ "text": "Transcribe the user's speech verbatim. Do not answer or converse." }]
    }
  }
}
```
送音：
```json
{ "realtimeInput": { "audio": { "data": "<BASE64_PCM16>", "mimeType": "audio/pcm;rate=16000" } } }
```
> ⚠️ Live input transcription 需要 `responseModalities: ["AUDIO"]` + `inputAudioTranscription: {}`。`TEXT` modality 已在實測中被 Google Live close，不可再用。
>
> ⚠️ Browser WebSocket `MessageEvent.data` 可能是 `Blob`，Live client 必須 normalize `string` / `Blob` / `ArrayBuffer` 後再 `JSON.parse`。

## 9. Cleanup prompt 規格
System prompt（核心）：
```
你是語音輸入文字整理器。
1. 保留原意，不要加新資訊。
2. 修正聽寫錯字。
3. 移除停頓詞（呃 / 嗯 / 就是就是）。
4. 補上自然標點。
5. 中英混合就保留自然中英混合。
6. 只輸出可直接貼上的文字，不要解釋。
```
模式差異：
- `message` — 自然簡潔，適合聊天
- `email` — 禮貌清楚，可直接寄
- `todo` — 每項動詞開頭
- `prompt` — 具體可直接餵 AI
- `semantic` — ✅ MVP1 已實作（2026-07-04）：不用上面呢個共用 system prompt，改用獨立 Smart Cleanup prompt + `/api/smart-cleanup` endpoint（見 §6.3）。目的唔係文法修正，而係從完整最終逐字稿推斷用戶最終真正想講嘅意思（處理猶豫、自我修正、改變主意）。Smart Cleanup 專屬 prompt：
```
You are a semantic cleanup engine for live speech transcripts.

Your job is to infer the user's current intended meaning from the full final transcript.

The transcript may contain:
- hesitations
- filler words
- repeated words
- self-corrections
- abandoned ideas
- changed decisions
- mixed Cantonese, Chinese, and English
- imperfect speech-to-text errors

Do not simply correct grammar.
Do not preserve abandoned thoughts unless they are needed to explain the final meaning.
Do not invent facts that are not supported by the transcript.
If the user clearly changes their mind, follow the latest decision.
If the user is still undecided, preserve that uncertainty.
Output concise, natural Traditional Chinese by default unless the transcript is clearly English.
Return JSON only.
```

## 10. 詳細開發步驟（Phase 1 對應 task）

### Epic A — 後端引擎
- **A1.** FastAPI skeleton + health route + CORS + config（讀 `.env`）。
- **A2.** `gemini/` adapter：包 `google-genai`，集中 model 名。
- **A3.** `POST /api/cleanup`（flash-lite）+ pydantic schema + test。
- **A4.** `POST /api/live-token`（Live connection credential/config endpoint）+ test。
- **A5.** Dockerfile + 加入 docker-compose。

### Epic B — 前端骨架
- **B1.** `npm create vite`（react-ts）+ ESLint/Prettier + vitest + vite-plugin-pwa。
- **B2.** UI：mic button、transcript preview、result textarea、copy/clear。
- **B3.** `audio/`：getUserMedia + AudioWorklet processor + resample + Float32→Int16（含 unit test）。
- **B4.** `live/`：Live WS client（拿 token、setup、送 audio、收 transcription）。
- **B5.** tap-to-toggle 串起 B2–B4：點一下開 session、放手繼續、再點一下停。
- **B6.** 停止錄音 → call `/api/cleanup` → 貼 textarea → copy。

### Epic C — Mock / 開發體驗
- **C1.** Mock 模式：假 transcript + 假 cleanup（env flag `MOCK_MODE`），不燒 API。
- **C2.** Audio debug panel：sampleRate / chunk samples / 轉換後 bytes。

### Epic D — 部署
- **D1.** docker-compose 前後端。
- **D2.** Cloudflare Tunnel HTTPS（host systemd `cloudflared.service`，Docker Compose 不管理 tunnel connector）。
- **D3.** iPhone 真機測試 + 修 iOS/PWA 坑。

## 11. 驗收標準（Phase 1 Done）
- **AC1.** iPhone Safari / Home Screen PWA tap-to-toggle 講中英混合一句，Live transcript 出現。
- **AC2.** 停止錄音後 < 3s，textarea 出整理好文字。
- **AC3.** 一鍵 copy 成功。
- **AC4.** DevTools / bundle 找不到 API key。
- **AC5.** Mock 模式可以完全不連 Gemini 開發 UI。

## 12. iOS Safari 注意事項
- AudioContext 要在 touch handler 內 `resume()`。
- 必須 HTTPS。
- 背景 / 鎖屏會斷麥 → 前景 tap-to-toggle 使用，不做背景錄音。
- standalone PWA 偶有麥克風 regression → 先用普通分頁測穩。
- 首次要 user gesture 才 request mic 權限；每個 page session 第一 tap 只做 permission priming，不當作正式錄音。

## 13. 風險登記
| 風險 | 解法 |
|---|---|
| API key 暴露 | key 留後端；`/api/live-token` 經 adapter 管理 credential/config；不得 hardcode 到前端 source |
| AudioWorklet / resample 複雜 | 先做最小 pipeline + debug panel + test |
| Live API preview 變動 | adapter 隔離 + 上線前對 model list |
| WebSocket 斷線 | setup 前 local buffer；reconnect 屬 Phase 3 |
| cleanup 改錯意思 | raw transcript toggle / undo |
| 燒 API 成本 | Mock 模式開發 |

## 14. 待決問題 (Open Questions)
- **Q1.** partial transcript 顯示策略（partial vs committed）。
- **Q2.** Phase 2 是否加入 raw transcript toggle / undo 作為 cleanup 信任機制。
- **Q3.** Phase 3 token endpoint auth / rate limit / public access policy。
- **Q4.** Debug counters 是否保留、隱藏或改為 debug mode。
