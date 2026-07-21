"""Unit tests for WebUI stream_bridge (GatewayStreamConsumer → delta/seq)."""
import unittest

from stream_bridge import (
    StreamBridgeState,
    begin_stream_delta,
    edit_stream_delta,
    strip_streaming_cursor,
)


class StreamBridgeTests(unittest.TestCase):
    def test_strip_cursor(self):
        self.assertEqual(strip_streaming_cursor("Hello ▉"), "Hello")
        self.assertEqual(strip_streaming_cursor("Hello"), "Hello")

    def test_begin_then_suffix_edits_then_finalize(self):
        state = StreamBridgeState()
        first = begin_stream_delta(state, "Hel ▉")
        self.assertEqual(first.kind, "delta")
        self.assertEqual(first.delta, "Hel")
        self.assertEqual(first.seq, 0)
        state.message_id = "msg-1"

        mid = edit_stream_delta(state, "Hello ▉", finalize=False)
        self.assertEqual(mid.delta, "lo")
        self.assertEqual(mid.seq, 1)
        self.assertFalse(mid.done)

        done = edit_stream_delta(state, "Hello!", finalize=True)
        self.assertTrue(done.done)
        self.assertEqual(done.content, "Hello!")
        self.assertEqual(done.delta, "!")
        self.assertFalse(done.noop)
        self.assertEqual(state.message_id, "msg-1")
        self.assertTrue(state.finalized)

        again = edit_stream_delta(state, "Hello!", finalize=True)
        self.assertTrue(again.done)
        self.assertTrue(again.noop)
        self.assertEqual(again.delta, "")
        self.assertEqual(again.content, "Hello!")

    def test_noop_edit_without_growth(self):
        state = StreamBridgeState()
        begin_stream_delta(state, "Hi ▉")
        state.message_id = "m"
        again = edit_stream_delta(state, "Hi ▉", finalize=False)
        self.assertEqual(again.delta, "")
        self.assertFalse(again.done)


if __name__ == "__main__":
    unittest.main()
