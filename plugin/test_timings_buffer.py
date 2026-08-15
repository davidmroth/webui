"""Unit tests for cron timings accumulation in the WebUI plugin."""

from __future__ import annotations

import unittest

from timings_buffer import (
    bind_chat_session,
    enrich_send_metadata,
    extract_timings_from_api_response,
    parse_cron_delivery,
    pop_chat_timings,
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
        self.assertEqual(out["effective_prompt_per_second"], round(1200 / 5.2, 3))
        self.assertEqual(out["actual_prompt_per_second"], round(400 / 5.2, 3))
        self.assertEqual(out["prompt_per_second"], round(400 / 5.2, 3))

    def test_extract_maps_cached_prefix_tokens(self) -> None:
        """dflash_server emits cached_prefix_tokens, not cache_n."""
        response = {
            "usage": {
                "prompt_tokens": 16992,
                "completion_tokens": 20,
                "timings": {
                    "prefill_ms": 29100.0,
                    "decode_ms": 900.0,
                    "cached_prefix_tokens": 17848,
                },
            }
        }
        out = extract_timings_from_api_response(response)
        self.assertIsNotNone(out)
        assert out is not None
        self.assertEqual(out["cache_n"], 17848)
        self.assertEqual(out["prompt_ms"], 29100.0)

    def test_extract_skips_empty_failed_completions(self) -> None:
        """Vision/empty failures must not become million-t/s stats cards."""
        response = {
            "usage": {
                "prompt_tokens": 18856,
                "completion_tokens": 0,
                "timings": {
                    "prompt_ms": 0.179,
                    "predicted_ms": 2271.642,
                    "ttft_ms": 0.179,
                    "predicted_n": 0,
                },
            }
        }
        self.assertIsNone(extract_timings_from_api_response(response))

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

    def test_webchat_stream_finalize_pops_chat_timings(self) -> None:
        chat_id = "conv-stream-stats-1"
        session_id = "20260721_024221_d09f8d94"
        bind_chat_session(chat_id, session_id)
        record_api_timings(
            session_id=session_id,
            platform="webchat",
            response={
                "usage": {
                    "prompt_tokens": 400,
                    "completion_tokens": 35,
                    "timings": {
                        "prefill_ms": 800.0,
                        "decode_ms": 1200.0,
                        "decode_tokens_per_sec": 29.0,
                        "ttft_ms": 220.0,
                    },
                }
            },
            api_duration=2.1,
        )
        timings = pop_chat_timings(chat_id)
        self.assertIsNotNone(timings)
        assert timings is not None
        self.assertEqual(timings.get("prompt_n"), 400)
        self.assertEqual(timings.get("predicted_n"), 35)
        self.assertAlmostEqual(float(timings.get("predicted_ms") or 0), 1200.0)
        self.assertEqual(pop_chat_timings(chat_id), None)

    def test_pop_preserves_binding_until_timings_arrive(self) -> None:
        """Stream finalize often races ahead of post_api_request."""
        chat_id = "conv-race-1"
        session_id = "20260731_race_session"
        bind_chat_session(chat_id, session_id)
        self.assertIsNone(pop_chat_timings(chat_id))
        record_api_timings(
            session_id=session_id,
            platform="webchat",
            response={
                "usage": {
                    "prompt_tokens": 50,
                    "completion_tokens": 10,
                    "timings": {"prefill_ms": 100.0, "decode_ms": 200.0},
                }
            },
        )
        timings = pop_chat_timings(chat_id)
        self.assertIsNotNone(timings)
        assert timings is not None
        self.assertEqual(timings.get("predicted_n"), 10)

    def test_subscribe_notifies_when_timings_arrive(self) -> None:
        from timings_buffer import subscribe_chat_timings

        chat_id = "conv-waiter-1"
        session_id = "20260801_waiter_session"
        bind_chat_session(chat_id, session_id)
        seen: list[dict] = []
        self.assertIsNone(subscribe_chat_timings(chat_id, seen.append))
        record_api_timings(
            session_id=session_id,
            platform="webchat",
            response={
                "usage": {
                    "prompt_tokens": 80,
                    "completion_tokens": 12,
                    "timings": {"prefill_ms": 50.0, "decode_ms": 90.0},
                }
            },
        )
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0].get("predicted_n"), 12)
        self.assertIsNone(pop_chat_timings(chat_id))

    def test_extract_keeps_engine_predicted_ms_when_prompt_ms_missing(self) -> None:
        response = {
            "timings": {
                "prompt_n": 19000,
                "predicted_n": 40,
                "cache_n": 18000,
                "predicted_ms": 900.0,
                "predicted_per_second": 44.0,
            },
            "usage": {"prompt_tokens": 19000, "completion_tokens": 40},
        }
        out = extract_timings_from_api_response(response, api_duration=2.0)
        self.assertIsNotNone(out)
        assert out is not None
        self.assertEqual(out["predicted_ms"], 900.0)
        self.assertEqual(out["predicted_per_second"], 44.0)

    def test_extract_accept_rate_from_timings(self) -> None:
        response = {
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 40,
                "timings": {
                    "prefill_ms": 200.0,
                    "decode_ms": 800.0,
                    "accept_rate": 0.196,
                },
            }
        }
        out = extract_timings_from_api_response(response)
        self.assertIsNotNone(out)
        assert out is not None
        self.assertEqual(out["accept_rate"], 0.196)

    def test_extract_normalizes_draft_accept_pct(self) -> None:
        response = {
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 40,
                "timings": {
                    "prefill_ms": 200.0,
                    "decode_ms": 800.0,
                    "draft_accept_pct": 19.6,
                },
            }
        }
        out = extract_timings_from_api_response(response)
        self.assertIsNotNone(out)
        assert out is not None
        self.assertAlmostEqual(out["accept_rate"], 0.196)

    def test_merge_token_weights_accept_rate(self) -> None:
        session_id = "cron_a1b2c3_20260804_120000"
        record_api_timings(
            session_id=session_id,
            platform="cron",
            response={
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 10,
                    "timings": {
                        "prefill_ms": 100.0,
                        "decode_ms": 200.0,
                        "accept_rate": 0.10,
                    },
                }
            },
        )
        record_api_timings(
            session_id=session_id,
            platform="cron",
            response={
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 30,
                    "timings": {
                        "prefill_ms": 100.0,
                        "decode_ms": 600.0,
                        "accept_rate": 0.30,
                    },
                }
            },
        )
        content = (
            "Cronjob Response: Accept Merge\n"
            "(job_id: a1b2c3)\n"
            "-------------\n"
            "Done"
        )
        metadata = enrich_send_metadata(content, None)
        self.assertIsNotNone(metadata)
        assert metadata is not None
        timings = metadata.get("timings")
        self.assertIsInstance(timings, dict)
        assert isinstance(timings, dict)
        # (0.10*10 + 0.30*30) / 40 = 0.25
        self.assertAlmostEqual(float(timings.get("accept_rate") or 0), 0.25)

    def test_shared_state_survives_dual_module_load(self) -> None:
        """Hook and adapter historically imported this file under different names."""
        import importlib.util
        import sys
        from pathlib import Path

        plugin_dir = Path(__file__).resolve().parent
        name = "webui_plugin_timings_buffer_dual_test"
        sys.modules.pop(name, None)
        spec = importlib.util.spec_from_file_location(name, plugin_dir / "timings_buffer.py")
        assert spec is not None and spec.loader is not None
        alt = importlib.util.module_from_spec(spec)
        sys.modules[name] = alt
        spec.loader.exec_module(alt)

        chat_id = "conv-dual-module"
        session_id = "20260721_dual_module_sess"
        alt.bind_chat_session(chat_id, session_id)
        alt.record_api_timings(
            session_id=session_id,
            platform="webchat",
            usage={"prompt_tokens": 11, "completion_tokens": 7},
            api_duration=0.5,
        )
        timings = pop_chat_timings(chat_id)
        self.assertIsNotNone(timings)
        assert timings is not None
        self.assertEqual(timings.get("prompt_n"), 11)
        self.assertEqual(timings.get("predicted_n"), 7)
        sys.modules.pop(name, None)

    def test_extract_llamacpp_usage_timings(self) -> None:
        response = {
            "usage": {
                "prompt_tokens": 900,
                "completion_tokens": 40,
                "timings": {
                    "prompt_ms": 1200.0,
                    "predicted_ms": 800.0,
                    "predicted_per_second": 50.0,
                    "ttft_ms": 210.0,
                    "cache_n": 100,
                },
            }
        }
        out = extract_timings_from_api_response(
            response, usage={"prompt_tokens": 900, "completion_tokens": 40}
        )
        self.assertIsNotNone(out)
        assert out is not None
        self.assertEqual(out["prompt_ms"], 1200.0)
        self.assertEqual(out["predicted_ms"], 800.0)
        self.assertEqual(out["predicted_per_second"], 50.0)
        self.assertEqual(out["ttft_ms"], 210.0)
        self.assertEqual(out["cache_n"], 100)

    def test_extract_from_system_fingerprint(self) -> None:
        response = {
            "system_fingerprint": "hermes_timings:prompt_ms=1500,predicted_ms=700,predicted_n=20,prompt_n=400",
            "usage": {"prompt_tokens": 400, "completion_tokens": 20},
        }
        out = extract_timings_from_api_response(
            response, usage={"prompt_tokens": 400, "completion_tokens": 20}
        )
        self.assertIsNotNone(out)
        assert out is not None
        self.assertEqual(out["prompt_ms"], 1500.0)
        self.assertEqual(out["predicted_ms"], 700.0)
        self.assertEqual(out["predicted_n"], 20)


if __name__ == "__main__":
    unittest.main()
