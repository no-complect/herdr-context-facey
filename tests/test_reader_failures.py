import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import reader_test_support  # noqa: F401
from reader import service
from reader.providers import get_provider
from reader.sources import ReadBudget


class ReaderFailureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, relative, rows):
        path = self.home / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))
        return path

    def test_external_nested_shape_errors_leave_a_partial_read_and_retry_later_records(self):
        cases = [
            (
                "codex",
                ".codex/sessions/2026/11/16/rollout-test0000.jsonl",
                [dict(type="event_msg", payload=dict(type="token_count", info=["bad"]))],
                dict(
                    type="response_item",
                    payload=dict(type="message", role="user", content="valid prompt"),
                ),
            ),
            (
                "claude",
                ".claude/projects/project/session.jsonl",
                [dict(type="assistant", message=dict(usage=["input_tokens"]))],
                dict(type="user", message=dict(content="valid prompt")),
            ),
            (
                "grok",
                ".grok/sessions/workspace/session/chat_history.jsonl",
                [],
                dict(type="user", content="valid prompt"),
            ),
        ]
        for provider, relative, bad_rows, valid in cases:
            with self.subTest(provider=provider):
                path = self.write(relative, bad_rows + [valid])
                if provider == "grok":
                    self.write(
                        str(path.with_name("updates.jsonl").relative_to(self.home)),
                        [dict(params=["bad"]), dict(params=dict(_meta=dict(totalTokens=100)))],
                    )
                result = service.summarize(path, self.home)
                self.assertEqual(result["events"][-1]["teaser"], "valid prompt")
                self.assertTrue(any("unsupported records" in note for note in result["notes"]))
                self.assertTrue(result["partial"])

    def test_permission_errors_have_a_distinct_safe_outcome(self):
        path = self.write(".grok/sessions/workspace/session/chat_history.jsonl", [])
        request = json.dumps(dict(version=1, provider="grok", path=str(path)))
        with patch.object(service, "summarize", side_effect=PermissionError("private diagnostic")):
            result = service.handle(request, self.home)
        self.assertEqual(result["error"]["code"], "permission_denied")
        self.assertNotIn("private diagnostic", json.dumps(result))

    def test_a_source_that_changes_during_the_read_is_explicitly_partial(self):
        path = self.write(
            ".grok/sessions/workspace/session/chat_history.jsonl",
            [dict(type="user", content="hello")],
        )
        request = json.dumps(dict(version=1, provider="grok", path=str(path)))
        with patch.object(service, "signature", side_effect=["before", "after"]):
            result = service.handle(request, self.home)
        self.assertTrue(result["partial"])
        self.assertEqual(result["revision"], "before")

    def test_unexpected_programming_errors_are_not_counted_as_bad_external_records(self):
        path = self.write(
            ".grok/sessions/workspace/session/chat_history.jsonl",
            [dict(type="user", content="hello")],
        )
        with patch.object(
            get_provider("grok"), "consume", side_effect=AttributeError("programming defect")
        ):
            with self.assertRaises(AttributeError):
                service.summarize(path, self.home)

    def test_read_budget_skips_oversized_records_and_keeps_the_next_line_identity(self):
        path = self.home / "records.jsonl"
        path.write_text(
            json.dumps(dict(content="x" * 200)) + "\n" + json.dumps(dict(content="hello")) + "\n"
        )
        budget = ReadBudget(max_bytes=1024, max_line=64)
        records = list(budget.records([(path, None)]))
        self.assertEqual([record.line for record in records], [2])
        self.assertEqual(records[0].row["content"], "hello")
        self.assertTrue(budget.notes)

    def test_byte_budget_is_shared_across_lineage_files(self):
        first = self.write("one.jsonl", [dict(content="first")])
        second = self.write("two.jsonl", [dict(content="second")])
        budget = ReadBudget(max_bytes=first.stat().st_size, max_line=100)
        records = list(budget.records([(first, None), (second, None)]))
        self.assertEqual(len(records), 1)
        self.assertLessEqual(budget.used, budget.max_bytes)
        self.assertTrue(any("read limit" in note for note in budget.notes))


if __name__ == "__main__":
    unittest.main()
