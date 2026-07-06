import json
import unittest
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

        bridge = api.StreamingTranscriptionBridge(sender=sender, processor_factory=processor_factory)
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


if __name__ == '__main__':
    unittest.main()
