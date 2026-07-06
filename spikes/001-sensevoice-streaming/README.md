# Spike: sense-voice-streaming-asr

Goal: verify whether a local CPU-only incremental SenseVoice wrapper can emit usable `partial_result` and `final_result` events for AITyping, without the current homemade RMS segmentation path.

## What was tested

- Runtime candidate: `nikoseven/sense-voice-streaming-asr`
- Host: Oracle ARM64 VPS (`aarch64`, 2 CPU, 11 GB RAM)
- Python env: `/home/ubuntu/experiment/voice_test/venv`
- Feed mode: 16 kHz mono WAV, chunked into 100 ms frames

## Important findings

### 1. Official sherpa-onnx SenseVoice is not the right target
Official sherpa-onnx SenseVoice examples are `simulate-streaming-*` and rely on VAD + non-streaming ASR. That is better than the current homemade RMS chunker, but still not the "true rolling partial" path we want.

### 2. `sense-voice-streaming-asr` is better than the current path, but not a native online decoder
This runtime does emit `partial_result` and `final_result` while audio is still arriving.
However, its implementation is **incremental re-decode of the growing utterance**:
- VAD runs incrementally
- ASR re-runs on the current speech window
- CTC argmax is re-decoded
- immutable prefix tokens are committed as `FINAL_RESULT`
- mutable suffix is sent as `PARTIAL_RESULT`

So this is not a transducer / cached online decoder, but product-wise it behaves much closer to what AITyping needs.

### 3. Package installation from Git alone is broken until model blobs are fetched
`pip install git+https://github.com/nikoseven/sense-voice-streaming-asr.git` only pulled Git LFS pointers for:
- `SenseVoiceSmall/model_quant.onnx`
- `speech_fsmn_vad_zh-cn-16k-common-onnx/model_quant.onnx`

The real model files had to be fetched manually from ModelScope `resolve/master/...` URLs.

### 4. The package has a model-loading quirk
`SenseVoiceModel()` could not be instantiated twice in one process due a reused `resources.path(...)` context-manager object. In practice this is survivable for a server design that loads models once globally.

## Verification results

### English sample (`heath_16k.wav`)
Observed event flow:
- `SPEECH_START`
- multiple `PARTIAL_RESULT`
- `FINAL_RESULT: "If you're good at something, never do it for free."`
- `SPEECH_END`

### Cantonese sample (`yue.wav` from sherpa SenseVoice test set)
Observed event flow:
- `SPEECH_START`
- multiple `PARTIAL_RESULT`
- `FINAL_RESULT: "呢几个字都表达唔到，我想讲嘅意思。"`
- `SPEECH_END`

### CPU timing on this VPS
Model load:
- ~4.5 s one-time startup

Steady-state processing:
- Cantonese sample `/tmp/yue.wav`: audio 5.148 s, processing 2.151 s, **RTF 0.418**
- English sample `/tmp/heath_16k.wav`: audio 3.024 s, processing 1.037 s, **RTF 0.343**
- Longer English sample `/tmp/cate_16k.wav`: audio 7.884 s, processing 5.811 s, **RTF 0.737**

Interpretation:
- On this 2-core CPU, single-stream realtime is plausible.
- Headroom is not huge for multiple concurrent sessions.

## Verdict

This runtime is **good enough to justify a proper integration spike**.

Recommended next step:
1. wrap this runtime behind a small FastAPI/WebSocket adapter
2. mirror AITyping's current WS contract (`speech_start`, rolling partials, final commit)
3. test on real iPhone Cantonese + Cantonese-English mixed speech
4. only then decide whether to replace the current `experiment/voice_test/api.py` path

## Files

- `test_driver.py`: feeds a 16 kHz WAV in 100 ms chunks and prints streaming events
