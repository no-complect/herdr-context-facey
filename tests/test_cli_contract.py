import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ENTRY = Path(__file__).parents[1] / "mods/herdr-context-facey/inspect_session.py"
# Exercise the real entry point without reading the developer's actual sessions.
HARNESS = """
import runpy, sys
from pathlib import Path
from unittest.mock import patch
entry, test_home, request = sys.argv[1:]
sys.path.insert(0, str(Path(entry).parent))
sys.argv = [entry, '--request', request]
with patch.object(Path, 'home', return_value=Path(test_home)):
    runpy.run_path(entry, run_name='__main__')
"""


class CliContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def call(self, request):
        raw = request if isinstance(request, str) else json.dumps(dict(version=1, **request))
        result = subprocess.run(
            [sys.executable, "-c", HARNESS, str(ENTRY), str(self.home), raw],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(result.stderr, "")
        response = json.loads(result.stdout)
        self.assertEqual(response.get("version"), 1)
        return response

    def write(self, relative, rows):
        path = self.home / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))
        return path

    def test_all_providers_produce_the_same_snapshot_and_preview_contract(self):
        cases = [
            (
                "codex",
                ".codex/sessions/2026/11/16/rollout-test0000.jsonl",
                dict(
                    type="response_item", payload=dict(type="message", role="user", content="hello")
                ),
                True,
            ),
            (
                "claude",
                ".claude/projects/project/session.jsonl",
                dict(type="user", message=dict(content="hello")),
                True,
            ),
            (
                "grok",
                ".grok/sessions/workspace/session/chat_history.jsonl",
                dict(type="user", content="hello"),
                False,
            ),
            (
                "agy",
                ".gemini/antigravity-cli/brain/session/.system_generated/logs/transcript.jsonl",
                dict(type="USER_INPUT", content="hello"),
                False,
            ),
        ]
        for provider, relative, row, compaction in cases:
            with self.subTest(provider=provider):
                path = self.write(relative, [row])
                request = dict(provider=provider, path=str(path))
                data = self.call(request)
                self.assertEqual(data["status"], "snapshot")
                self.assertEqual(data["session"]["provider"], provider)
                self.assertEqual(data["session"]["path"], str(path))
                self.assertEqual(data["capabilities"]["compaction"], compaction)
                self.assertTrue(data["revision"])
                event = data["events"][0]
                self.assertEqual(event["category"], "user")
                self.assertEqual(len(event["record_hash"]), 64)
                preview = self.call(
                    dict(
                        action="detail", session=data["session"], revision=data["revision"], **event
                    )
                )
                self.assertEqual(preview["status"], "detail")
                self.assertEqual(preview["text"], "hello")
                unchanged = self.call(dict(request, revision=data["revision"]))
                self.assertEqual(unchanged["status"], "unchanged")
                self.assertNotIn("events", unchanged)

    def test_rewritten_history_is_a_stale_event_outcome(self):
        relative = ".grok/sessions/workspace/session/chat_history.jsonl"
        path = self.write(relative, [dict(type="user", content="original")])
        data = self.call(dict(provider="grok", path=str(path)))
        self.write(relative, [dict(type="user", content="replacement")])
        result = self.call(
            dict(
                action="detail",
                session=data["session"],
                revision=data["revision"],
                **data["events"][0],
            )
        )
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error"]["code"], "stale_event")
        self.assertNotIn("replacement", json.dumps(result))

    def test_invalid_requests_return_a_structured_error_instead_of_a_traceback(self):
        for request in [
            '{"version": 1',
            "[]",
            '{"version": 2}',
            '{"version": 1, "action": "delete"}',
            '{"version": 1, "provider": "unknown"}',
        ]:
            with self.subTest(request=request):
                response = self.call(request)
                self.assertEqual(response["status"], "error")
                self.assertEqual(response["error"]["code"], "invalid_request")

    def test_no_session_and_unavailable_source_are_distinct_outcomes(self):
        response = self.call(dict(provider="grok"))
        self.assertEqual(response["status"], "selection_required")
        self.assertEqual(response["code"], "no_session")
        missing = self.home / ".grok/sessions/workspace/missing/chat_history.jsonl"
        response = self.call(dict(provider="grok", path=str(missing)))
        self.assertEqual(response["status"], "error")
        self.assertEqual(response["error"]["code"], "source_unavailable")

    def test_detail_requires_a_fingerprint_and_a_matching_session_provider(self):
        path = self.write(
            ".grok/sessions/workspace/session/chat_history.jsonl",
            [dict(type="user", content="hello")],
        )
        data = self.call(dict(provider="grok", path=str(path)))
        event = data["events"][0]
        event.pop("record_hash")
        request = dict(action="detail", session=data["session"], revision=data["revision"], **event)
        response = self.call(request)
        self.assertEqual(response["error"]["code"], "invalid_request")
        request["record_hash"] = "a" * 64
        request["session"] = dict(data["session"], provider="agy")
        response = self.call(request)
        self.assertEqual(response["status"], "error")


if __name__ == "__main__":
    unittest.main()
