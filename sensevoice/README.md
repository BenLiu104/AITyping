# SenseVoice STT Service — 開發者 & Operator 指引

> 廣東話語音轉文字，基於 FunAudioLLM SenseVoiceSmall + `sense-voice-streaming-asr` streaming wrapper。
> 跑喺 VPS ARM64 CPU，**host systemd（唔係 Docker）**，經 Cloudflare Tunnel 對外。
>
> - **Public**: `https://<sensevoice-domain>`（Cloudflare Tunnel）
> - **Internal**: `http://<vps>:8082`
> - **Service**: `sensevoice-api.service`（systemd）
> - **Repo path**: `sensevoice/`（此目錄，venv 就地建）
>
> 詳細部署步驟見 [DEPLOY.md](DEPLOY.md)。

---

## 點解用 SenseVoice？

| 特性 | SenseVoice | OpenAI Whisper |
|------|-----------|----------------|
| 粵語口語字 | ✅ 保留「呢、唔、嘅、啲」 | ❌ 強制轉書面語 |
| 語言 detect | ✅ 自動分辨 yue / zh / en | ❌ 將粵語當做 zh |
| 速度 (CPU) | ✅ ~8–17× realtime | ❌ ~0.3–0.5× |
| 情緒 / Audio event | ✅ 附送 | ❌ 無 |
| License | 開源，商用友好 | MIT |

---

## 架構定位

SenseVoice 係 AITyping 三大 service 之一，**唯一跑喺 host systemd（唔入 Docker）**：

| Service | 技術 | 部署 |
|---|---|---|
| frontend | Vite PWA | GitHub Pages |
| backend | FastAPI（Gemini adapter） | VPS Docker |
| **sensevoice** | **Flask + WS（此目錄）** | **VPS host systemd** |

前端經 `frontend/src/live/sensevoice-ws-client.ts` 打 `wss://.../ws/transcribe-v2`。

---

## API Endpoints

| Method | Path | 用途 |
|---|---|---|
| GET  | `/ping` | 健康檢查 |
| POST | `/transcribe` | 單檔轉錄（legacy，見下） |
| POST | `/transcribe_batch` | 批量轉錄（legacy，見下） |
| WS   | `/ws/transcribe` | streaming v1（保留回退） |
| WS   | `/ws/transcribe-v2` | **★ streaming v2（前端現用）** |

### 健康檢查

```bash
curl https://<sensevoice-domain>/ping
```

Response: `{"status": "ok", "model_loaded": true}`

---

## WebSocket v2 — 主要合約（`/ws/transcribe-v2`）

這是前端現用的唯一推薦接口。

### 音訊格式（必須）

- **Encoding**: 16-bit signed little-endian PCM（raw，無 WAV header）
- **Sample rate**: 16 kHz
- **Channels**: mono
- **來源**: AudioWorklet（不可用 MediaRecorder，iOS Safari 輸出 AAC/MP4）

### Client → Server

| Message type | 格式 | 說明 |
|---|---|---|
| 音訊 | binary bytes | 16kHz 16-bit LE PCM frames，持續推送 |
| 語言切換 | text `LANG:<lang>` | 例如 `LANG:yue`、`LANG:zh`、`LANG:auto` |
| 結束信號 | text `END` | 通知 server flush 當前 utterance |

### Server → Client

所有 server 回應均為 JSON text frame：

```
{"transcript": "...", "is_final": false}          ← partial_result
{"transcript": "...", "is_final": true}            ← final_result
{"transcript": "", "is_final": true, "end_ack": true}  ← END 已處理
{"error": "..."}                                   ← 錯誤
```

- **partial_result**: 增量識別中間結果，`is_final: false`
- **final_result**: 一個 utterance 完成，`is_final: true`
- **end_ack**: 收到 `END` 後，flush 完成確認；`end_ack: true` 代表 session 可安全結束

### 支援語言

`normalize_streaming_language()` 會映射以下值：

| 傳入值 | 實際使用 |
|---|---|
| `yue` | `yue`（廣東話，**default**） |
| `zh`、`zh-Hant`、`zh-Hans` | `zh`（普通話） |
| `en` | `en`（英語） |
| `ja` | `ja`（日語） |
| `ko` | `ko`（韓語） |
| `auto`、`mixed`、（其他） | `auto`（自動 detect） |
| 空字串 | `yue` |

---

## 私隱與診斷（預設行為）

**預設不保留任何 raw audio、WAV、JSONL trace 或 transcript summary 到 disk。**
WebSocket payload 處理、`partial_result` / `final_result` / `end_ack` 流程不受此影響。

如需短暫診斷，**只有 operator** 可在啟動 process 前設定：

```bash
SENSEVOICE_DEBUG_TRACE=1  # 啟用 /tmp/sv-debug disk trace
```

這是 opt-in；**用戶無法透過 WebSocket 要求開啟**。診斷結束後應移除此環境變數，恢復預設 no-op trace。

---

## Legacy REST 路由（不推薦）

> ⚠️ `/transcribe` 與 `/transcribe_batch` 係舊版 file-upload REST 接口，**前端不使用**。
> 只保留用於 offline 測試或一次性批量任務。**新整合請用 `/ws/transcribe-v2`**。

```bash
# 單檔轉錄（legacy）
curl -X POST https://<sensevoice-domain>/transcribe \
  -F "audio=@recording.wav" \
  -F "language=yue"
```

Response:
```json
{
  "transcript": "呢几个字都表达唔到我想讲嘅意思。",
  "detected_language": "yue",
  "emotion": "NEUTRAL",
  "audio_event": "Speech",
  "processing_time_s": 1.095
}
```

支援格式：`.wav`, `.mp3`, `.m4a`, `.flac`, `.ogg`, `.opus`, `.webm`（最大 25 MB）。

---

## 服務管理

```bash
# 睇狀態
sudo systemctl status sensevoice-api

# 睇 log（即時）
sudo journalctl -u sensevoice-api -f

# 最近 50 行
sudo journalctl -u sensevoice-api -n 50 --no-pager

# 重啟（update code 後）
sudo systemctl restart sensevoice-api
```

---

## 測試

```bash
cd sensevoice
PYTHONPATH=. ./venv/bin/python -m unittest tests.test_ws_v2 -v
```

測試用 `FakeProcessor` mock 咗 ASR runtime，唔需要真模型（~0.04s）。

---

## 部署

見 [DEPLOY.md](DEPLOY.md)：從零 clone → `./setup.sh` → systemd unit render → 啟動。

> ⚠️ venv 不可搬移（shebang 寫死絕對路徑）。換路徑必須重跑 `./setup.sh` 重建。

---

## 本地容器 POC（實驗性）

> ⚠️ **現行 production 路徑仍是 host systemd `sensevoice-api.service`（port 8082）。**
> 容器 POC 係獨立實驗，不改動 / 不取代 systemd 服務。

```bash
# 在 repo 根目錄執行（build context = ./sensevoice）
docker compose --profile sensevoice-local build sensevoice
docker compose --profile sensevoice-local up -d sensevoice

# 健康檢查
curl http://localhost:7860/ping   # {"status":"ok","model_loaded":true}

# 停止並清理
docker compose --profile sensevoice-local down
```

- `docker compose up`（無 profile）**不會**啟動容器 POC，現有服務不受影響。
- 目前只驗證 ARM64 本地 build；x86 / HF Spaces 驗證 pending。
- 詳見 `sensevoice/Dockerfile` + `docker-compose.yml` `sensevoice-local` profile。

---

*最後更新：2026-07-10*
