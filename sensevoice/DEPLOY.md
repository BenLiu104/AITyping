# SenseVoice STT Service — 部署與維護

> 廣東話語音轉文字 API，基於阿里 FunAudioLLM SenseVoiceSmall + `sense-voice-streaming-asr`
> streaming wrapper。跑喺 VPS ARM64 CPU，**host systemd（唔係 Docker）**。
>
> - **Public**: `https://sencevoice.bochibb.qzz.io`（Cloudflare Tunnel）
> - **Internal**: `http://<vps>:8082`
> - **Service**: `sensevoice-api.service`
> - **API 教學**: 見 `README.md`

---

## 1. 架構定位

AITyping 三大 service 之一：

| Service | 技術 | 部署 | Repo 位置 |
|---|---|---|---|
| frontend | Vite PWA | GitHub Pages | `frontend/` |
| backend | FastAPI（Gemini adapter） | VPS Docker | `backend/` |
| **sensevoice** | **Flask + WS（本目錄）** | **VPS host systemd** | `sensevoice/` |

前端經 `frontend/src/live/sensevoice-ws-client.ts` 打 `wss://.../ws/transcribe-v2`。

> ⚠️ **點解唔用 Docker**：模型 blob 大 + ARM64 CPU 推理要直接食 host 資源，
> 現行決策係 host systemd + Cloudflare Tunnel 直通。切勿改成 Docker container
> 而唔同 Ben 對齊（見 root `STATUS.md` §5 pitfalls）。

## 2. 從零部署

```bash
# 1. 目錄（VPS 現行路徑，systemd WorkingDirectory 指住呢度）
cd /home/ubuntu/experiment/voice_test    # 或任何你 clone 出嚟嘅 sensevoice/

# 2. venv + 依賴（~2GB，含 onnxruntime / funasr / librosa）
python3.11 -m venv venv
./venv/bin/pip install -r requirements.txt

# 3. 模型 blob —— pip 只會攞 Git LFS pointer，真 model 要手動 fetch
#    SenseVoiceSmall/model_quant.onnx + FSMN-VAD model_quant.onnx
#    由 ModelScope resolve/master/... 下載（見 spikes/001-sensevoice-streaming）
#    funasr 首次 run 會自動下載 fsmn-vad 去 ~/.cache

# 4. 試跑
./venv/bin/python api.py --preload --port 8082
```

## 3. systemd unit

`/etc/systemd/system/sensevoice-api.service`：

```ini
[Unit]
Description=SenseVoice Cantonese STT API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/experiment/voice_test
ExecStart=/home/ubuntu/experiment/voice_test/venv/bin/python /home/ubuntu/experiment/voice_test/api.py --preload --port 8082
Restart=always
RestartSec=5
Environment="PYTHONUNBUFFERED=1"
Environment="PATH=/home/ubuntu/experiment/voice_test/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[Install]
WantedBy=multi-user.target
```

> ⚠️ `WorkingDirectory` / `ExecStart` 目前指向 `experiment/voice_test`。若日後將
> 執行路徑搬去 repo checkout，兩處都要同步更新再 `systemctl daemon-reload`。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sensevoice-api
systemctl status sensevoice-api
journalctl -u sensevoice-api -f      # 睇 log
```

## 4. API endpoints（詳見 README.md）

| Method | Path | 用途 |
|---|---|---|
| GET  | `/ping` | 健康檢查 |
| POST | `/transcribe` | 單檔轉錄 |
| POST | `/transcribe_batch` | 批量 |
| WS   | `/ws/transcribe` | streaming v1（保留回退） |
| WS   | `/ws/transcribe-v2` | ★ streaming v2（前端現用） |

## 5. 測試

```bash
cd sensevoice
PYTHONPATH=. ./venv/bin/python -m unittest tests.test_ws_v2 -v
```

> 測試用 `FakeProcessor` mock 咗 ASR runtime，唔需要真模型，可快速跑（~0.04s）。
