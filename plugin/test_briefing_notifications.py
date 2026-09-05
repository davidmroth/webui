"""Tests for create_briefing notifications sent to WebUI."""

from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

import briefing_notifications


class _Response:
    def raise_for_status(self) -> None:
        return None


class _Client:
    def __init__(self, calls: list[dict], **kwargs):
        self._calls = calls
        self._calls.append({"timeout": kwargs["timeout"]})

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def post(self, url, *, headers, json):
        self._calls.append({"url": url, "headers": headers, "json": json})
        return _Response()


class BriefingNotificationTests(unittest.TestCase):
    def test_create_briefing_posts_catalog_row(self):
        calls: list[dict] = []

        with patch.dict(
            os.environ,
            {
                "WEBCHAT_URL": "http://webui:3000/",
                "WEBCHAT_SERVICE_TOKEN": "service-token",
                "WEBCHAT_HOME_CHANNEL": "home-conversation",
            },
            clear=False,
        ):
            briefing_notifications.on_post_tool_call(
                "create_briefing",
                {
                    "title": "Daily briefing",
                    "summary": "Top stories.",
                },
                json.dumps(
                    {
                        "success": True,
                        "job_id": "job-123",
                        "status": "processing",
                    }
                ),
                client_factory=lambda **kwargs: _Client(calls, **kwargs),
            )

        self.assertEqual(calls[0], {"timeout": 10.0})
        self.assertEqual(
            calls[1]["url"],
            "http://webui:3000/api/internal/hermes/briefings",
        )
        self.assertEqual(
            calls[1]["headers"]["Authorization"],
            "Bearer service-token",
        )
        self.assertEqual(
            calls[1]["json"],
            {
                "jobId": "job-123",
                "state": "processing",
                "conversationId": "home-conversation",
                "title": "Daily briefing",
                "summary": "Top stories.",
            },
        )

    def test_completed_briefing_maps_to_ready(self):
        payload = briefing_notifications._notification_payload(
            {},
            json.dumps(
                {
                    "success": True,
                    "job_id": "job-complete",
                    "status": "completed",
                }
            ),
        )

        self.assertEqual(payload["state"], "ready")

    def test_failed_or_unrelated_tool_results_do_not_post(self):
        calls: list[dict] = []
        factory = lambda **kwargs: _Client(calls, **kwargs)

        briefing_notifications.on_post_tool_call(
            "create_briefing",
            {},
            json.dumps({"success": False, "job_id": "job-failed"}),
            client_factory=factory,
        )
        briefing_notifications.on_post_tool_call(
            "terminal",
            {},
            json.dumps({"success": True, "job_id": "job-unrelated"}),
            client_factory=factory,
        )

        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
