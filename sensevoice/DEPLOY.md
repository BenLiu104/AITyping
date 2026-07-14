# SenseVoice STT Service — 部署與維護

> 廣東話語音轉文字 API，基於阿里 FunAudioLLM SenseVoiceSmall + `sense-voice-streaming-asr`
> streaming wrapper。現行跑喺 VPS ARM64 CPU 的 **Docker Compose** service；host systemd unit 只保留作 rollback。
>
> - **Public**: `https://<sensevoice-domain>`（Cloudflare Tunnel）
> - **Host mapping**: `8082 → container 7860`
> - **Service**: `docker compose --profile sensevoice-local up -d sensevoice`
> - **Rollback**: `sensevoice-api.service`（現時 inactive）

---

## 1. 架構定位

AITyping 三大 service 之一：

| Service | 技術 | 部署 | Repo 位置 |
|---|---|---|---|
| frontend | Vite PWA | GitHub Pages | `frontend/` |
| backend | FastAPI（Gemini adapter） | VPS Docker | `backend/` |
| **sensevoice** | **Flask + WS（本目錄）** | **VPS Docker Compose（host 8082 → 7860）** | `sensevoice/` |

前端經 `frontend/src/live/sensevoice-ws-client.ts` 先向 backend mint v2 token，再打 `wss://.../ws/transcribe-v2?token=...`。

> host `sensevoice-api.service` 尚未刪除，但不可與 container 同時 bind 8082；只在 rollback 時手動切換。

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
2. `pip install -r requirements.txt`
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
| WS   | `/ws/transcribe-v2` | ★ 唯一 streaming STT 接口（**token-gated**） |

> **v2 授權：** `/ws/transcribe-v2` 要求後端簽發的短效 HMAC token（見 README「授權」節）。
> 部署時必須設 `SENSEVOICE_WS_TOKEN_SECRET`（與 AITyping backend 共用同一 secret）；缺 secret 即 fail closed 拒連。
> **安全邊界：** legacy endpoint 已移除；所有 STT session 都必須先通過 v2 short-lived token。token endpoint 仍無 user auth / rate limit，公開招攬用戶前必須另行處理 access policy 與 rate limit。

## 5. 測試

```bash
cd sensevoice
# WS v2 streaming 單元測試（mock ASR runtime，無需真模型，~0.04s）
PYTHONPATH=. ./venv/bin/python -m unittest tests.test_ws_v2 -v
# 容器 config 契約靜態測試（Dockerfile cache 分層 / compose profile / streaming model integrity）
PYTHONPATH=. ./venv/bin/python -m unittest tests.test_container_config -v
```

> `test_ws_v2` 用 `FakeProcessor` mock 咗 ASR runtime，唔需要真模型。
> `test_container_config` 純 stdlib 靜態解析 Dockerfile / docker-compose.yml /
> .dockerignore，守住 build-cache 分層、profile gating、streaming model integrity 契約，改壞即 fail。

## 6. 容器化部署（現行 VPS runtime；HF Spaces 下一階段）

> **現行 production 路徑：** VPS Docker Compose `sensevoice`，host `8082 → container 7860`，由既有 host Cloudflare Tunnel 導流。`sensevoice-api.service` 保留但 inactive 作 rollback。

### 現況

| 路徑 | 狀態 |
|---|---|
| VPS Docker Compose + CF Tunnel | ✅ 已部署；Ben iPhone mixed-mode 驗收通過 |
| host systemd + CF Tunnel | 🟡 rollback only；不可與 container 同時 bind 8082 |
| x86 / HF Docker Spaces | ⏸️ x86 image 已發布；HF Docker Space 要求 PRO，Ben 暫停 migration |
| Backend short-lived WS token | ✅ 已部署；shared secret 只注入 backend + SenseVoice container |

### VPS container 操作

```bash
# repo 根目錄；.env 必須有 SENSEVOICE_WS_TOKEN_SECRET
SENSEVOICE_HOST_PORT=8082 docker compose --profile sensevoice-local up -d --build sensevoice
curl http://localhost:8082/ping

# rollback（先停 container 釋放 8082，才重啟 systemd）
docker compose --profile sensevoice-local stop sensevoice
sudo systemctl start sensevoice-api.service
```

- `docker compose up`（無 profile）**不會**起 SenseVoice。
- image build 時只把 streaming ONNX STT + VAD 模型 bake in，無需 runtime cache volume。
- `SENSEVOICE_WS_TOKEN_SECRET` 必須只由 Compose environment injection 傳入；不可使用 `env_file` 將 backend 的其他 secrets 傳進 STT container。

### 模型 pin 與完整性（容器）

容器把 streaming ONNX 模型 bake 入 image，pin 與完整性 manifest 如下：

| 類別 | 來源 | pin 定義處 | 完整性 manifest | build 內驗證 |
|---|---|---|---|---|
| streaming ONNX | ModelScope `iic/*` | `fetch_models.py` MODELS[].revision | `models.sha256`（package 目錄核對） | `sha256sum -c models.sha256` |

> Dockerfile 只將 requirements / `fetch_models.py` / `models.sha256` 放喺昂貴 model layer 前 COPY；`api.py` / `tests/` 喺 ONNX fetch + verify **之後**先 COPY，改 source 唔會重下載模型。

### HF 遷移決策（已確認，尚未執行）

最終路徑為 Hugging Face CPU Docker Space，對外提供 public endpoint，沿用 backend 簽發 short-lived v2 WS token。先完成 x86 image、HF WS / cold-start 實測與 iPhone cutover 驗收，才停止 VPS Compose SenseVoice；詳見 root `STATUS.md` 的 HF migration plan。

## 7. 已知坑（redeploy 必讀）

**venv 不可搬移。** venv `bin/` 內嘅 script（`pip`、`ruff` 等）shebang 寫死絕對路徑
（`#!/…/venv/bin/python3.11`）。`mv`／`cp -r` venv 去新路徑後，呢啲 shebang 仍指舊路徑，
一 exec 就 `FileNotFoundError`，可能造成 crash loop。**正解：喺新路徑重跑 `./setup.sh` 重建。**

**pip-from-git 唔會落 submodule / LFS 模型。** 見 §2「模型下載」——用 `fetch_models.py`
由 ModelScope 攞真權重，`models.sha256` 把關。
