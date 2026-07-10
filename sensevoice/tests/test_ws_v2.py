import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import numpy as np

import api


class FakeProcessor:
    def __init__(self, on_event):
        self.on_event = on_event
        self.accepted = []
        self.finalized = False

    def accept_audio(self, audio):
        self.accepted.append(audio.copy())

    def finalize_utterance(self):
        self.finalized = True
        self.on_event('StreamingASREventType.PARTIAL_RESULT', '呢几个字')
        self.on_event('StreamingASREventType.FINAL_RESULT', '呢几个字都表达唔到，我想讲嘅意思。')


class FakeTrace:
    def __init__(self, language):
        self.calls = [('start', language)]

    def update_language(self, language):
        self.calls.append(('language', language))

    def on_control(self, message):
        self.calls.append(('control', message))

    def on_chunk(self, raw_bytes):
        self.calls.append(('chunk', raw_bytes))

    def on_event(self, event_name, text, is_final):
        self.calls.append(('event', event_name, text, is_final))

    def on_end_ack(self):
        self.calls.append(('end_ack',))

    def finish(self, reason):
        self.calls.append(('finish', reason))


class StreamingTranscriptionBridgeTests(unittest.TestCase):
    def test_normalize_streaming_language(self):
        self.assertEqual(api.normalize_streaming_language('mixed'), 'auto')
        self.assertEqual(api.normalize_streaming_language('yue'), 'yue')
        self.assertEqual(api.normalize_streaming_language(''), 'yue')

    def test_bridge_uses_normalized_language_and_emits_partial_final_and_end_ack(self):
        sent_messages = []
        factory_calls = []
        created_processors = []

        def sender(payload: str):
            sent_messages.append(json.loads(payload))

        def processor_factory(language, on_event):
            factory_calls.append(language)
            processor = FakeProcessor(on_event)
            created_processors.append(processor)
            return processor

        bridge = api.StreamingTranscriptionBridge(
            sender=sender,
            processor_factory=processor_factory,
            trace_factory=lambda language: api.NoOpWsTraceSession(),
        )
        bridge.handle_text_message('LANG:mixed')
        bridge.handle_binary_message(np.array([0, 32767, -32768], dtype=np.int16).tobytes())
        bridge.handle_text_message('END')

        self.assertEqual(factory_calls, ['auto'])
        self.assertEqual(len(created_processors), 1)
        self.assertTrue(created_processors[0].finalized)

        accepted = created_processors[0].accepted[0]
        self.assertEqual(accepted.dtype, np.float32)
        self.assertAlmostEqual(float(accepted[0]), 0.0, places=6)
        self.assertGreater(float(accepted[1]), 0.99)
        self.assertLess(float(accepted[2]), -0.99)

        self.assertEqual(sent_messages[0], {'transcript': '呢幾個字', 'is_final': False})
        self.assertEqual(sent_messages[1], {'transcript': '呢幾個字都表達唔到，我想講嘅意思。', 'is_final': True})
        self.assertEqual(sent_messages[2], {'transcript': '', 'is_final': True, 'end_ack': True})

    def test_default_bridge_trace_is_noop_and_never_creates_trace_directory(self):
        with TemporaryDirectory() as temporary_directory:
            trace_root = Path(temporary_directory) / 'sv-debug'
            with patch.dict(os.environ, {'SENSEVOICE_DEBUG_TRACE': '1'}):
                with patch.dict(os.environ, {}, clear=True), patch.object(api, 'TRACE_ROOT', trace_root), patch.object(
                    api,
                    'WsTraceSession',
                    side_effect=AssertionError('default/no-op test must not construct disk trace sessions'),
                ):
                    bridge = api.StreamingTranscriptionBridge(
                        sender=lambda payload: None,
                        processor_factory=lambda language, on_event: FakeProcessor(on_event),
                    )
                    bridge.handle_binary_message(np.array([1, -1], dtype=np.int16).tobytes())
                    bridge.handle_text_message('END')
                    bridge.finish('test_complete')

            self.assertFalse(trace_root.exists())
            self.assertIsInstance(bridge.trace, api.NoOpWsTraceSession)
            self.assertFalse(hasattr(bridge.trace, 'raw_audio'))

    def test_bridge_forwards_trace_lifecycle_to_injected_trace_factory(self):
        traces = []

        def trace_factory(language):
            trace = FakeTrace(language)
            traces.append(trace)
            return trace

        bridge = api.StreamingTranscriptionBridge(
            sender=lambda payload: None,
            processor_factory=lambda language, on_event: FakeProcessor(on_event),
            trace_factory=trace_factory,
        )
        raw_bytes = np.array([1, -1], dtype=np.int16).tobytes()
        bridge.handle_text_message('LANG:mixed')
        bridge.handle_binary_message(raw_bytes)
        bridge.handle_text_message('END')
        bridge.finish('test_complete')

        self.assertEqual(len(traces), 1)
        self.assertEqual(
            traces[0].calls,
            [
                ('start', 'yue'),
                ('control', 'LANG:mixed'),
                ('language', 'mixed'),
                ('chunk', raw_bytes),
                ('control', 'END'),
                ('event', 'StreamingASREventType.PARTIAL_RESULT', '呢幾個字', False),
                ('event', 'StreamingASREventType.FINAL_RESULT', '呢幾個字都表達唔到，我想講嘅意思。', True),
                ('end_ack',),
                ('finish', 'test_complete'),
            ],
        )


if __name__ == '__main__':
    unittest.main()
