"""Unit tests for cron timings accumulation in the WebUI plugin."""

from __future__ import annotations

import unittest

from timings_buffer import (
    enrich_send_metadata,
    extract_timings_from_api_response,
    parse_cron_delivery,
    pop_delivery_timings,
    record_api_timings,
)


class TimingsBufferTests(unittest.TestCase):
    def test_parse_cron_delivery(self) -> None:
        content = (
            "Cronjob Response: Daily AI News Digest\n"
            "(job_id: 9e2114f61177)\n"
            "-------------\n"
            "Body here"
        )
        parsed = parse_cron_delivery(content)
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed["job_id"], "9e2114f61177")
        self.assertEqual(parsed["job_name"], "Daily AI News Digest")

    def test_extract_engine_timings_shape(self) -> None:
        response = {
            "usage": {
                "prompt_tokens": 1200,
                "completion_tokens": 300,
                "timings": {
                    "prefill_ms": 5200.0,
                    "decode_ms": 4100.0,
                    "decode_tokens_per_sec": 11.4,
                    "ttft_ms": 900.0,
                    "cache_n": 800,
                },
            }
        }
        out = extract_timings_from_api_response(response)
        self.assertIsNotNone(out)
        assert out is not None
        self.assertEqual(out["prompt_n"], 1200)
        self.assertEqual(out["predicted_n"], 300)
        self.assertEqual(out["prompt_ms"], 5200.0)
        self.assertEqual(out["predicted_ms"], 4100.0)
        self.assertEqual(out["predicted_per_second"], 11.4)
        self.assertEqual(out["ttft_ms"], 900.0)
        self.assertEqual(out["cache_n"], 800)

    def test_aggregate_and_attach_on_cron_delivery(self) -> None:
        session_id = "cron_abc123_20260719_175428"
        for idx in range(2):
            record_api_timings(
                session_id=session_id,
                platform="cron",
                response={
                    "usage": {
                        "prompt_tokens": 1000 + idx,
                        "completion_tokens": 200 + idx,
                        "timings": {
                            "prefill_ms": 1000.0,
                            "decode_ms": 2000.0,
                            "decode_tokens_per_sec": 10.0,
                            "ttft_ms": 500.0 if idx == 0 else None,
                        },
                    }
                },
                api_duration=3.0,
            )

        content = (
            "Cronjob Response: Test Job\n"
            "(job_id: abc123)\n"
            "-------------\n"
            "Done"
        )
        metadata = enrich_send_metadata(content, None)
        self.assertIsNotNone(metadata)
        assert metadata is not None
        timings = metadata.get("timings")
        self.assertIsInstance(timings, dict)
        assert isinstance(timings, dict)
        self.assertEqual(timings.get("api_calls"), 2)
        self.assertEqual(timings.get("prompt_n"), 2001)
        self.assertEqual(timings.get("predicted_n"), 401)
        self.assertAlmostEqual(float(timings.get("prompt_ms") or 0), 2000.0)
        self.assertAlmostEqual(float(timings.get("predicted_ms") or 0), 4000.0)
        self.assertEqual(timings.get("ttft_ms"), 500.0)
        self.assertEqual(pop_delivery_timings("abc123"), None)

    def test_non_cron_sessions_are_ignored(self) -> None:
        record_api_timings(
            session_id="cli-session-1",
            platform="cli",
            response={"usage": {"prompt_tokens": 10, "completion_tokens": 5, "timings": {"prefill_ms": 1.0, "decode_ms": 2.0}}},
        )
        metadata = enrich_send_metadata(
            "Cronjob Response: X\n(job_id: deadbeef)\n-------------\n",
            None,
        )
        self.assertIsNotNone(metadata)
        assert metadata is not None
        self.assertNotIn("timings", metadata)


if __name__ == "__main__":
    unittest.main()
