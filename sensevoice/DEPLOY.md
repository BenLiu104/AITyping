# SenseVoice STT Service — 部署與維護

> 廣東話語音轉文字 API，基於阿里 FunAudioLLM SenseVoiceSmall + `sense-voice-streaming-asr`
> streaming wrapper。跑喺 VPS ARM64 CPU，**host systemd（唔係 Docker）**。
>
> - **Public**: `https://<sensevoice-domain>`（Cloudflare Tunnel）
> - **Internal**: `http://<vps>:8082`
> - **Service**: `sensevoice-api.service`
> - **API 合約 / 操作指引**: 見 `README.md`

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

## 2. 從零部署（可重現）

```bash
# 1. Clone repo，入 sensevoice 目錄
cd <INSTALL_DIR>          # 你 clone 出嚟嘅 sensevoice/

# 2. 一鍵建 venv + 依賴 + 模型（就地建，唔可搬移）
./setup.sh               # 加 --recreate 可刪舊 venv 重建

# 3. 試跑
./venv/bin/python api.py --preload --port 8082
```

`setup.sh` 做咗乜：
1. 喺 `sensevoice/venv` **就地**建 venv（venv 不可搬移，見 §6）
2. `pip install -r requirements.txt`（torch CPU wheel 經 extra-index）
3. 核對 `models.sha256`；若模型缺失／係指標檔，跑 `fetch_models.py`
   由 **ModelScope 官方 `iic/*`**（pinned revision）下載真 ONNX 權重，
   copy 入 `sense_voice_streaming_asr/models/`
4. 最後 `sha256sum -c models.sha256` fail-hard 把關

### 模型下載（點解要特別處理）

`sense-voice-streaming-asr` 嘅模型係 **ModelScope git submodule**；
`pip install git+...` **唔會** init submodule，所以 `model_quant.onnx`
落地時係細指標檔而唔係真權重 → onnxruntime 會 `InvalidProtobuf` crash。

`fetch_models.py` 由 canonical 上游下載（Alibaba DAMO 官方）：

| 模型 | ModelScope repo | pinned revision |
|---|---|---|
| SenseVoiceSmall | `iic/SenseVoiceSmall-onnx` | `0dd101a9…` |
| FSMN-VAD | `iic/speech_fsmn_vad_zh-cn-16k-common-onnx` | `a158155e…` |

正確性由 `models.sha256`（7 個檔）保證，唔係靠信下載。
手動 fetch：`./venv/bin/python fetch_models.py`。

> 註：funasr 另有自己嘅 FSMN-VAD + SenseVoiceSmall `.pt`（file-transcription 路徑用），
> 首次 run 會自動落 `~/.cache/huggingface`，與上述 streaming ONNX 分開。

## 3. systemd unit

範本喺 `sensevoice/sensevoice-api.service.template`（佔位符 `__INSTALL_DIR__` / `__RUN_USER__`）。
產生實際 unit：

```bash
sed -e "s#__INSTALL_DIR__#$(pwd)#g" -e "s#__RUN_USER__#$(whoami)#g" \
    sensevoice-api.service.template | sudo tee /etc/systemd/system/sensevoice-api.service

sudo systemctl daemon-reload
sudo systemctl enable --now sensevoice-api
systemctl status sensevoice-api
journalctl -u sensevoice-api -f      # 睇 log
```

實際 unit 內容（render 後）等同：

```ini
[Unit]
Description=SenseVoice Cantonese STT API
After=network.target

[Service]
Type=simple
User=<RUN_USER>
WorkingDirectory=<INSTALL_DIR>
ExecStart=<INSTALL_DIR>/venv/bin/python <INSTALL_DIR>/api.py --preload --port 8082
Restart=always
RestartSec=5
Environment="PYTHONUNBUFFERED=1"
Environment="PATH=<INSTALL_DIR>/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[Install]
WantedBy=multi-user.target
```

> ⚠️ 換路徑＝喺新路徑重跑 `./setup.sh` 重建 venv，再 render 新 unit。
> **切勿 `mv`／`cp -r` 舊 venv**（bin/ script shebang 寫死絕對路徑，搬完即壞，見 §6）。


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
# WS v2 streaming 單元測試（mock ASR runtime，無需真模型，~0.04s）
PYTHONPATH=. ./venv/bin/python -m unittest tests.test_ws_v2 -v
# 容器 config 契約靜態測試（Dockerfile cache 分層 / compose profile / model pin）
PYTHONPATH=. ./venv/bin/python -m unittest tests.test_container_config -v
```

> `test_ws_v2` 用 `FakeProcessor` mock 咗 ASR runtime，唔需要真模型。
> `test_container_config` 純 stdlib 靜態解析 Dockerfile / docker-compose.yml /
> .dockerignore / model_pins.py，守住 build-cache 分層、profile gating、model
> revision pin 契約，改壞即 fail。

## 6. 容器化部署（實驗性 / HF Spaces 準備中）

> ⚠️ **現行 canonical production 路徑：host systemd `sensevoice-api.service`（port 8082）+ Cloudflare Tunnel。**
> 容器路徑為實驗性 POC，**尚未上線**，不改動任何現行服務。

### 現況

| 路徑 | 狀態 |
|---|---|
| host systemd + CF Tunnel | ✅ Canonical production（本文件前面各節） |
| 本地容器 POC | ✅ ARM64 build + handshake 已驗證（feat/sensevoice-container-poc） |
| x86 / HF Docker Spaces | ⏳ Pending — 未驗證 |
| Backend short-lived WS token | ⏳ Pending — 未實作 |

### 本地 POC 快速運行

```bash
# repo 根目錄
docker compose --profile sensevoice-local build sensevoice
docker compose --profile sensevoice-local up -d sensevoice
curl http://localhost:7860/ping
docker compose --profile sensevoice-local down
```

- `docker compose up`（無 profile）**不會**起此容器。
- 映像在 build 時把 streaming ONNX + FunASR .pt 模型全數 bake in，無需 volume mount。
  若掛載 `~/.cache/huggingface` runtime mount，**會靜默遮蓋** bake 入的模型副本；
  POC 不需要此 mount。

### 模型 pin 與完整性（容器）

容器把兩類模型 bake 入 image，各有獨立 pin + 完整性 manifest：

| 類別 | 來源 | pin 定義處 | 完整性 manifest | build 內驗證 |
|---|---|---|---|---|
| streaming ONNX | ModelScope `iic/*` | `fetch_models.py` MODELS[].revision | `models.sha256`（package 目錄核對） | `sha256sum -c models.sha256` |
| FunASR `.pt`（SenseVoiceSmall + FSMN-VAD） | HF hub | `model_pins.py`（api.py runtime 亦 import 同一份） | `funasr_models.sha256`（baked HF cache 核對） | `verify_funasr_cache.py` |

> `model_pins.py` 係 runtime（`api.py`）同 build（Dockerfile preload）**共用嘅單一 pin 來源**，
> 確保 host systemd 同容器載入完全相同嘅 artifact，manifest 不會與實際推理 drift。
> Dockerfile 已重排 layer：只有 requirements / fetch_models / manifests / model_pins
> 喺昂貴 model layer 前 COPY；`api.py` / `tests/` 喺所有 fetch/preload/verify layer
> **之後**先 COPY，改 source 唔會 bust model cache。

### 遷移決策（尚未確認）

容器化最終路徑預計為 Hugging Face CPU Docker Space，對外提供 public endpoint，
backend 簽發 short-lived WS token 做存取控制。此決策**尚未批准 / 尚未實作**，
不在本 POC 範圍內。

## 7. 已知坑（redeploy 必讀）

**venv 不可搬移。** venv `bin/` 內嘅 script（`pip`、`ruff` 等）shebang 寫死絕對路徑
（`#!/…/venv/bin/python3.11`）。`mv`／`cp -r` venv 去新路徑後，呢啲 shebang 仍指舊路徑，
一 exec 就 `FileNotFoundError`。funasr 載模型時會 self-`pip install` model requirements，
撞正就 crash loop（`status=6/ABRT`）。**正解：喺新路徑重跑 `./setup.sh` 重建。**

**pip-from-git 唔會落 submodule / LFS 模型。** 見 §2「模型下載」——用 `fetch_models.py`
由 ModelScope 攞真權重，`models.sha256` 把關。
