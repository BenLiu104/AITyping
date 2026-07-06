import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from sense_voice_streaming_asr.sense_voice_streaming_asr import SenseVoiceStreamingASR, StreamingASRConfig
from sense_voice_streaming_asr.model_data import SenseVoiceModel, VadModel


def main(wav_path: str):
    audio, sr = sf.read(wav_path, dtype='float32')
    if audio.ndim > 1:
        audio = audio[:, 0]
    if sr != 16000:
        raise SystemExit(f'Expected 16k wav, got {sr}')

    events = []
    processor = SenseVoiceStreamingASR(
        asr_model=SenseVoiceModel(),
        vad_model=VadModel(),
        config=StreamingASRConfig(lang='auto', asr_result_update_interval_ms=500, vad_end_persistence_ms=500),
    )

    def on_event(event_type, message):
        evt = {'type': str(event_type), 'message': message}
        events.append(evt)
        print(json.dumps(evt, ensure_ascii=False), flush=True)

    processor.set_on_event_callback(on_event)

    chunk_samples = 1600  # 100ms
    for i in range(0, len(audio), chunk_samples):
        chunk = audio[i:i+chunk_samples]
        processor.accept_audio(np.asarray(chunk, dtype=np.float32))
    processor.finalize_utterance()

    Path('/tmp/sensevoice_streaming_events.json').write_text(json.dumps(events, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: python test_driver.py <wav_path>')
    main(sys.argv[1])
