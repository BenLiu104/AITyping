# SenseVoice Cantonese STT API — 教學文件

> 基於阿里巴巴 FunAudioLLM 嘅 SenseVoiceSmall 模型，喺 ARM64 CPU VPS 上 self-host 嘅廣東話語音轉文字 API。
>
> **Server:** `http://<VPS_IP>:8082`
> **Service:** `sensevoice-api.service` (systemd)

---

## 目錄

1. [點解用 SenseVoice？](#1-點解用-sensevoice)
2. [系統架構](#2-系統架構)
3. [API 使用說明](#3-api-使用說明)
   - [健康檢查](#31-健康檢查)
   - [語音轉文字](#32-語音轉文字)
   - [批量轉錄](#33-批量轉錄)
4. [PWA 整合範例](#4-pwa-整合範例)
5. [管理與維護](#5-管理與維護)
   - [服務管理](#51-服務管理)
   - [睇 Log](#52-睇-log)
   - [更新 Model](#53-更新-model)
6. [Benchmark 數據](#6-benchmark-數據)
7. [疑難排解](#7-疑難排解)
8. [進階設定](#8-進階設定)
   - [改用 ONNX 加速](#81-改用-onnx-加速)
   - [反向代理 (Nginx)](#82-反向代理-nginx)
   - [改用其他模型](#83-改用其他模型)

---

## 1. 點解用 SenseVoice？

| 特性 | SenseVoice | OpenAI Whisper (原裝) |
|------|-----------|----------------------|
| 粵語口語字 | ✅ 保留「呢、唔、嘅、啲」 | ❌ 強制轉書面語「這、不、的」 |
| 語言 detect | ✅ 自動分辨 `yue` / `zh` / `en` | ❌ 將粵語當做 `zh` |
| 速度 (CPU) | ✅ ~8-17x realtime | ❌ ~0.3-0.5x realtime |
| 情緒檢測 | ✅ 附送 | ❌ 無 |
| Audio event | ✅ 辨認 Speech / Music / BGM | ❌ 無 |
| License | 開源，商用友好 | MIT |

### 實際輸出比較 （同一個 audio 檔）

| Model | Output |
|-------|--------|
| **SenseVoice** | 呢几个字都表达**唔**到，我想讲**嘅**意思。 |
| Whisper-small | 這幾個字都表達**不**到我想講**的**意思。 |

SenseVoice 保留廣東話口語特色，Whisper 轉晒做書面語。

---

## 2. 系統架構

```
手機 PWA / Client
    │
    │ POST /transcribe (multipart: audio file)
    ▼
┌─────────────────────────────────┐
│  Flask API (port 8082)          │
│  ┌───────────────────────────┐  │
│  │  SenseVoiceSmall (ONNX/)  │  │
│  │  - 語音識別                │  │
│  │  - 語言 detect (yue/zh)   │  │
│  │  - 情緒識別                │  │
│  │  - Audio event detection  │  │
│  └───────────────────────────┘  │
│  Model size: ~800 MB (RAM)      │
│  Inference: PyTorch CPU         │
└─────────────────────────────────┘
    │
    ▼
 JSON response:
 {"transcript": "呢几个字...",
  "detected_language": "yue",
  "processing_time_s": 1.2}
```

### File layout

```
~/experiment/voice_test/
├── api.py                    ← Flask API 主程式
├── sensevoice-api-guide.md   ← 呢份文件
├── venv/                     ← Python virtualenv
│   └── .../
└── requirements.txt          ← 未獨立抽，見 pip list
```

---

## 3. API 使用說明

### 3.1 健康檢查

```bash
curl http://<VPS_IP>:8082/ping
```

Response:
```json
{
  "status": "ok",
  "model_loaded": true
}
```

---

### 3.2 語音轉文字

**Endpoint:** `POST /transcribe`

**Content-Type:** `multipart/form-data`

**Parameters:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `audio` | File | **required** | Audio file (.wav, .mp3, .m4a, .flac, .ogg, .opus, .webm) |
| `language` | string | `yue` | `yue` (廣東話), `zh` (普通話), `auto` (自動 detect) |

**Example:**

```bash
curl -X POST http://<VPS_IP>:8082/transcribe \
  -F "audio=@recording.wav" \
  -F "language=yue"
```

**Response:**
```json
{
  "transcript": "呢几个字都表达唔到我想讲嘅意思。",
  "raw": "<|yue|><|NEUTRAL|><|Speech|><|withitn|>呢几个字都表达唔到我想讲嘅意思。",
  "detected_language": "yue",
  "emotion": "NEUTRAL",
  "audio_event": "Speech",
  "processing_time_s": 1.095
}
```

**Field 說明：**

| Field | 意思 |
|-------|------|
| `transcript` | 淨文字（已剝 HTML tag） |
| `raw` | 原始輸出（連 metadata tag） |
| `detected_language` | Detect 到嘅語言 |
| `emotion` | 情緒：`NEUTRAL` / `HAPPY` / `SAD` / `ANGRY` |
| `audio_event` | Audio 類別：`Speech` / `Music` / `BGM` / `Applause` |
| `processing_time_s` | 處理時間（秒） |

---

### 3.3 批量轉錄

**Endpoint:** `POST /transcribe_batch`

一次過送多個 audio 檔，全部轉完一次過回。

```bash
curl -X POST http://<VPS_IP>:8082/transcribe_batch \
  -F "audio=@file1.wav" \
  -F "audio=@file2.wav" \
  -F "language=yue"
```

Response:
```json
{
  "results": [
    {
      "filename": "file1.wav",
      "transcript": "我想講嘅意思。",
      "processing_time_s": 0.8
    },
    {
      "filename": "file2.wav",
      "transcript": "你好嗎？",
      "processing_time_s": 0.6
    }
  ],
  "count": 2
}
```

---

## 4. PWA 整合範例

### 4.1 JavaScript (Browser)

```javascript
async function transcribeCantonese(audioBlob) {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.wav');
  formData.append('language', 'yue');

  const res = await fetch('http://<VPS_IP>:8082/transcribe', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  const data = await res.json();
  return data.transcript;  // 「呢几个字都表达唔到...」
}

// Example: record from microphone and transcribe
async function recordAndTranscribe() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);

  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const text = await transcribeCantonese(blob);
    document.getElementById('output').textContent = text;
  };

  recorder.start();
  setTimeout(() => recorder.stop(), 5000); // Record 5 seconds
}
```

### 4.2 iOS Safari 注意事項

iOS Safari 嘅 `MediaRecorder` 支援有限。建議用 AudioContext + WAV 編碼：

```javascript
// iOS-friendly: record PCM WAV instead of webm
async function recordWAV(durationMs = 5000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(stream);
  const recorder = ctx.createScriptProcessor(4096, 1, 1);

  const chunks = [];
  recorder.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };

  src.connect(recorder);
  recorder.connect(ctx.destination);

  return new Promise((resolve) => {
    setTimeout(() => {
      // Stop recording
      src.disconnect();
      recorder.disconnect();
      stream.getTracks().forEach(t => t.stop());

      // Convert Float32Array to WAV Blob
      const totalLen = chunks.reduce((s, c) => s + c.length, 0);
      const audio = new Float32Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        audio.set(chunk, offset);
        offset += chunk.length;
      }

      const wav = encodeWAV(audio, 16000);
      resolve(new Blob([wav], { type: 'audio/wav' }));
    }, durationMs);
  });
}

// Helper: Float32Array → WAV ArrayBuffer
function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);       // PCM
  view.setUint16(22, 1, true);       // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++)
    view.setUint8(offset + i, string.charCodeAt(i));
}
```

### 4.3 Swift (iOS App)

```swift
import Foundation

func transcribeCantonese(audioData: Data) async throws -> String {
    let url = URL(string: "http://<VPS_IP>:8082/transcribe")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"

    let boundary = UUID().uuidString
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

    var body = Data()
    body.append("--\(boundary)\r\n".data(using: .utf8)!)
    body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"record.wav\"\r\n".data(using: .utf8)!)
    body.append("Content-Type: audio/wav\r\n\r\n".data(using: .utf8)!)
    body.append(audioData)
    body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
    request.httpBody = body

    let (data, _) = try await URLSession.shared.data(for: request)
    let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    return json["transcript"] as! String
}
```

---

## 5. 管理與維護

### 5.1 服務管理

```bash
# 睇狀態
sudo systemctl status sensevoice-api

# 重啟 (例如 update code 之後)
sudo systemctl restart sensevoice-api

# 停用
sudo systemctl stop sensevoice-api

# 開機自動啟動 (已 enable)
sudo systemctl enable sensevoice-api

# 關閉自動啟動
sudo systemctl disable sensevoice-api
```

### 5.2 睇 Log

```bash
# 即時 tail
sudo journalctl -u sensevoice-api -f

# 最近 50 行
sudo journalctl -u sensevoice-api -n 50 --no-pager

# 某個時間範圍
sudo journalctl -u sensevoice-api --since "2026-06-30 00:00:00" --until "2026-06-30 02:00:00"
```

### 5.3 更新 Model

SenseVoiceSmall 由 HuggingFace 自動 cache 喺 `~/.cache/huggingface/hub/`。要更新：

```bash
cd ~/experiment/voice_test
source venv/bin/activate

# 清 cache 再 reload
rm -rf ~/.cache/huggingface/hub/models--FunAudioLLM--SenseVoiceSmall
sudo systemctl restart sensevoice-api
```

---

## 6. Benchmark 數據

**Hardware:** Oracle VPS (ARM64, Ampere A1, 4 vCPU, 24GB RAM)
**Model:** SenseVoiceSmall (PyTorch CPU)
**Audio:** Real Cantonese speech clip (~3 seconds)

| Test | Latency | RTFx |
|------|---------|------|
| PyTorch (first run, includes model load) | ~30s | — |
| PyTorch (subsequent, 3s audio) | ~0.75-2.6s | ~1.2-4x |
| PyTorch (with ONNX, estimated) | ~0.3-0.5s | ~6-10x |

**記憶體使用量：**
- Model loaded: ~409 MB
- Per request: ~+50 MB (釋放後回收)
- Idle: ~410 MB

---

## 7. 疑難排解

### API 回 503 / 連唔到

```bash
# 1. 睇 service 狀態
sudo systemctl status sensevoice-api

# 2. 睇 log 有冇 error
sudo journalctl -u sensevoice-api -n 20 --no-pager

# 3. 確保 port 有 listen
ss -tlnp | grep 8082

# 4. 重啟
sudo systemctl restart sensevoice-api
```

### Transcription 出亂碼 / 簡體字

SenseVoice 預設出繁體定簡體取決於 training data。如果出簡體，可以用 OpenCC 做後處理：

```python
# 安裝
pip install opencc-python-reimplemented

# 使用
from opencc import OpenCC
cc = OpenCC('s2t')  # 簡→繁
text = cc.convert(transcript)
```

如果想直接喺 API 加呢個功能，話我知，可以 patch 落去。

### Memory 唔夠

如果 VPS 有 memory pressure：

```bash
# 睇 memory usage
free -h

# Model 用 ~410 MB，如果唔夠可以考慮：
# - 用 swap (但會慢)
# - 轉用更細嘅模型 (但冇 Cantonese fine-tune)
```

### API 好慢

PyTorch CPU inference 大約 ~1-2.5s per clip。如果想快啲，可以轉 ONNX runtime（見 §8.1），預計快 2-3 倍。

---

## 8. 進階設定

### 8.1 改用 ONNX 加速

FunASR 支援 ONNX runtime，ARM64 上可以快 2-3 倍：

```bash
cd ~/experiment/voice_test
source venv/bin/activate

# 安裝 ONNX runtime (CPU version)
pip install onnxruntime onnxruntime-extensions

# Clone FunASR ONNX model
pip install funasr_onnx

# 然後改 api.py 用 OnnxTranscriber
```

主要改動係 `api.py` 裡面用：

```python
from funasr_onnx import SenseVoiceSmall

model = SenseVoiceSmall(
    model_dir="FunAudioLLM/SenseVoiceSmall",
    batch_size=1,
    quantize=True,  # INT8 quantization for faster CPU
)
```

**注意：** `funasr_onnx` 嘅 ARM64 支援要確認一下。有機會需要由 source build ONNX Runtime。

### 8.2 反向代理 (Nginx)

如果想經 standard port 80/443 或者加 HTTPS：

```nginx
# /etc/nginx/sites-available/sensevoice
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # 加大 upload size (for audio files)
        client_max_body_size 50M;
    }
}
```

如果要 HTTPS，用 Certbot + Let's Encrypt：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 8.3 改用其他模型

FunASR 支援多個模型，可以就咁換：

| Model | 語言 | 速度 | 準確度 |
|-------|------|------|--------|
| `SenseVoiceSmall` | yue/zh/ja/ko/en | 🚀 最快 | ⭐⭐⭐⭐ |
| `SenseVoiceLarge` | 50+ languages | 🐢 慢啲 | ⭐⭐⭐⭐⭐ |
| `Fun-ASR-Nano` | zh/en/ja | 🚀 最快 | ⭐⭐⭐ |

改 model 就改 `api.py` 入面：

```python
# 改做 Fun-ASR-Nano
model = AutoModel(
    model="FunAudioLLM/Fun-ASR-Nano-2512",
    trust_remote_code=True,
)
```

---

## API Reference Card

```text
BASE URL: http://<VPS_IP>:8082

GET  /ping                    → {"status":"ok","model_loaded":true}
POST /transcribe              → {"transcript":"...","processing_time_s":...}
     Form: audio=@file.wav
           language=yue|zh|auto

POST /transcribe_batch        → {"results":[...],"count":N}
     Form: audio=@file1.wav (multiple)
           language=yue|zh|auto
```

---

*最後更新：2026-06-30*
*如有問題，直接喺 Telegram 搵我，或者睇 log 揾線索。*