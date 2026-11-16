import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "inspector", Path(__file__).parents[1] / "mods/herdr-context-facey/inspect_session.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name).resolve()
        self.grok = self.home / ".grok/sessions/workspace/grok-session/chat_history.jsonl"
        self.agy = (
            self.home
            / ".gemini/antigravity-cli/brain/agy-session/.system_generated/logs/transcript.jsonl"
        )

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, path, rows):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))
        return path

    def grok_metadata(self):
        self.grok.with_name("summary.json").write_text(
            json.dumps(
                dict(
                    info=dict(id="grok-session", cwd="/project"),
                    generated_title="Grok title",
                    current_model_id="grok-model",
                )
            )
        )

    def test_grok_uses_retained_history_without_counting_update_mirrors_or_reasoning(self):
        self.write(
            self.grok,
            [
                dict(type="system", content="private runtime"),
                dict(type="user", synthetic_reason="compaction_meta", content="saved summary"),
                dict(type="user", content=[dict(type="text", text="inspect a file")]),
                dict(
                    type="user", synthetic_reason="system_reminder", content="private injected rule"
                ),
                dict(type="reasoning", encrypted_content="private hidden reasoning"),
                dict(
                    type="assistant",
                    content="checking",
                    model_id="grok-model",
                    tool_calls=[
                        dict(id="call", name="read_file", arguments='{"path":"example.py"}')
                    ],
                ),
                dict(type="tool_result", tool_call_id="call", content="file contents"),
            ],
        )
        self.grok_metadata()
        self.write(
            self.grok.with_name("updates.jsonl"),
            [
                dict(timestamp=1000, params=dict(_meta=dict(totalTokens=5000))),
                dict(
                    timestamp=2000,
                    params=dict(
                        _meta=dict(totalTokens=1200),
                        update=dict(
                            sessionUpdate="agent_message_chunk",
                            content=dict(type="text", text="checking"),
                        ),
                    ),
                ),
            ],
        )
        result = m.summarize(self.grok, self.home)
        self.assertEqual(result["reported"]["input"], 1200)
        self.assertEqual(result["reported"]["kind"], "context")
        self.assertIsNone(result["reported"]["window"])
        self.assertEqual(result["model"], "grok-model")
        self.assertEqual(len(result["usage_samples"]), 1)
        self.assertEqual(result["usage_samples"][0]["afterId"], int(result["events"][-1]["id"]))
        self.assertEqual(
            [e["category"] for e in result["events"]],
            ["runtime", "summary", "user", "instructions", "assistant", "calls", "files"],
        )
        self.assertEqual(result["latest_segment"], 0)
        self.assertNotIn("private hidden reasoning", str(result))
        self.assertNotIn("private injected rule", str(result))
        for event in result["events"]:
            request = dict(source=event["source"], line=event["line"], field=event["field"])
            preview = m.detail(request, self.home)["text"]
            if event["protected"]:
                self.assertNotIn("private runtime", preview)
                self.assertNotIn("private injected rule", preview)
            elif event["category"] == "files":
                self.assertEqual(preview, "file contents")
            elif event["category"] == "calls":
                self.assertIn("example.py", preview)

    def test_grok_refreshes_when_only_usage_changes_and_does_not_fabricate_missing_usage(self):
        self.write(self.grok, [dict(type="user", content="hello")])
        before = m.signature(self.grok, self.home)
        self.assertIsNone(m.summarize(self.grok, self.home)["reported"])
        self.write(
            self.grok.with_name("updates.jsonl"), [dict(params=dict(_meta=dict(totalTokens=0)))]
        )
        self.assertNotEqual(m.signature(self.grok, self.home), before)
        self.assertEqual(m.summarize(self.grok, self.home)["reported"]["input"], 0)

    def test_grok_process_files_canonicalize_to_one_session_and_cwd_does_not_guess(self):
        self.write(self.grok, [dict(type="user", content="hello")])
        self.grok_metadata()
        with patch.object(
            m.subprocess,
            "run",
            return_value=SimpleNamespace(
                stdout="n"
                + str(self.grok)
                + "\nn"
                + str(self.grok.with_name("updates.jsonl"))
                + "\n"
            ),
        ):
            path, _, _, matched = m.resolve(dict(provider="grok", pid=123), self.home)
        self.assertEqual(path, self.grok)
        self.assertEqual(matched, "Foreground process file")
        path, candidates, reason, _ = m.resolve(dict(provider="grok", cwd="/project"), self.home)
        self.assertIsNone(path)
        self.assertEqual(candidates[0]["id"], "grok-session")
        self.assertIn("Choose", reason)
        self.assertEqual(
            m.resolve(dict(provider="grok", session_id="grok-session"), self.home)[0], self.grok
        )

    def test_agy_separate_cache_buckets_and_previews_exclude_thinking(self):
        self.write(
            self.agy,
            [
                dict(
                    step_index=0,
                    type="USER_INPUT",
                    created_at="2026-11-16T12:00:00Z",
                    content="inspect this",
                ),
                dict(
                    step_index=1,
                    type="PLANNER_RESPONSE",
                    input_tokens=10,
                    cache_read_tokens=90,
                    output_tokens=3,
                    thinking="PRIVATE THOUGHT",
                    content="visible reply",
                    tool_calls=[dict(name="view_file", args=dict(Path="example.py"))],
                ),
                dict(
                    step_index=2,
                    type="GENERIC",
                    content="recorded file text",
                    truncated_fields=["content"],
                ),
            ],
        )
        # The full export mirrors these steps; it must never be counted a second time.
        self.write(
            self.agy.with_name("transcript_full.jsonl"),
            [dict(type="USER_INPUT", content="duplicate")],
        )
        result = m.summarize(self.agy, self.home)
        self.assertEqual(result["reported"]["input"], 100)
        self.assertEqual(result["reported"]["cached"], 90)
        self.assertIsNone(result["reported"]["window"])
        self.assertEqual(
            [e["category"] for e in result["events"]], ["user", "assistant", "calls", "results"]
        )
        self.assertNotIn("PRIVATE THOUGHT", str(result))
        self.assertNotIn("duplicate", str(result))
        self.assertTrue(any("truncated" in note for note in result["notes"]))
        request = dict(source=str(self.agy), line=2, field="agy:content")
        self.assertEqual(m.detail(request, self.home)["text"], "visible reply")
        request["field"] = "agy:call:0"
        self.assertIn("example.py", m.detail(request, self.home)["text"])
        request["field"] = "thinking"
        self.assertNotIn("PRIVATE THOUGHT", m.detail(request, self.home)["text"])

    def test_agy_discovery_supports_both_default_roots_and_decodes_workspace_uris(self):
        for product in ["antigravity-cli", "antigravity"]:
            root = self.home / ".gemini" / product
            path = self.write(
                root / "brain/agy-session/.system_generated/logs/transcript.jsonl", []
            )
            cache = root / "cache/conversation_metadata.json"
            cache.parent.mkdir(parents=True)
            cache.write_text(
                json.dumps(
                    dict(
                        conversations={
                            "agy-session": dict(
                                summary=dict(
                                    Title="Agy title", WorkspaceURIs=["file:///project%20one"]
                                )
                            )
                        }
                    )
                )
            )
            candidates = m.extra_candidates("agy", self.home)
            candidate = next(c for c in candidates if c["path"] == str(path))
            self.assertEqual(candidate["name"], "Agy title")
            self.assertEqual(candidate["cwd"], "/project one")
            self.assertEqual(m.session_id(path, self.home), "agy-session")

    def test_new_sources_reject_auth_files_cross_provider_paths_and_symlink_escapes(self):
        self.write(self.grok, [])
        self.write(self.agy, [])
        for path in [
            self.home / ".grok/auth.json",
            self.agy.with_name("transcript_full.jsonl"),
            self.home / ".gemini/antigravity-cli/history.jsonl",
        ]:
            with self.assertRaises(ValueError):
                m.allowed(path, self.home)
        with self.assertRaises(ValueError):
            m.resolve(dict(provider="grok", path=str(self.agy)), self.home)
        outside = self.home / "private.jsonl"
        outside.write_text("private")
        self.grok.unlink()
        self.grok.symlink_to(outside)
        with self.assertRaises(ValueError):
            m.allowed(self.grok, self.home)

    def test_agy_presence_lock_identifies_the_foreground_conversation(self):
        self.write(self.agy, [dict(type="USER_INPUT", content="hello")])
        root = self.home / ".gemini/antigravity-cli"
        presence = root / "presence/agy-session.lock"
        output = "n" + str(root / "settings.json") + "\nn" + str(presence) + "\n"
        with patch.object(m.subprocess, "run", return_value=SimpleNamespace(stdout=output)):
            path, _, reason, matched = m.resolve(dict(provider="agy", pid=123), self.home)
        self.assertEqual(path, self.agy)
        self.assertIsNone(reason)
        self.assertEqual(matched, "Foreground process file")
        with self.assertRaises(ValueError):
            m.allowed(presence, self.home)

    def test_grok_event_writer_identifies_the_session_without_reading_its_events(self):
        self.write(self.grok, [dict(type="user", content="hello")])
        self.grok_metadata()
        for name in ["events.jsonl", "chat_history.jsonl.lock", "updates.jsonl.lock"]:
            output = "n" + str(self.grok.with_name(name)) + "\n"
            with patch.object(m.subprocess, "run", return_value=SimpleNamespace(stdout=output)):
                path, _, reason, _ = m.resolve(dict(provider="grok", pid=123), self.home)
            self.assertEqual(path, self.grok)
            self.assertIsNone(reason)
        with self.assertRaises(ValueError):
            m.allowed(self.grok.with_name("events.jsonl"), self.home)

    def test_multiple_presence_locks_remain_ambiguous(self):
        self.write(self.agy, [])
        other = self.write(
            self.agy.parents[3] / "another-session/.system_generated/logs/transcript.jsonl", []
        )
        root = self.home / ".gemini/antigravity-cli/presence"
        output = (
            "n"
            + str(root / "agy-session.lock")
            + "\nn"
            + str(root / (other.parents[2].name + ".lock"))
            + "\n"
        )
        with patch.object(m.subprocess, "run", return_value=SimpleNamespace(stdout=output)):
            path, _, reason, _ = m.resolve(dict(provider="agy", pid=123), self.home)
        self.assertIsNone(path)
        self.assertIn("Choose", reason)


if __name__ == "__main__":
    unittest.main()
