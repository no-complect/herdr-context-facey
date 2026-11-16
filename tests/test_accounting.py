import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import reader_test_support  # noqa: F401
from reader import accounting
from reader import service as m
from reader.providers import claude, codex


class AccountingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.root = self.home / ".codex/sessions/2026/11/16"
        self.root.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, records):
        path = self.root / ("rollout-" + name + ".jsonl")
        path.write_text("".join(json.dumps(r) + "\n" for r in records))
        return path

    def record(self, typ, **payload):
        return dict(type=typ, payload=payload, timestamp="2026-11-16T12:00:00Z")

    def test_usage_counts_cached_input_once_and_ignores_mirror_and_reasoning(self):
        path = self.write(
            "usage000",
            [
                self.record(
                    "response_item",
                    type="message",
                    role="user",
                    content=[dict(type="input_text", text="hello")],
                ),
                self.record("event_msg", type="user_message", message="hello"),
                self.record("response_item", type="reasoning", encrypted_content="opaque" * 1000),
                self.record(
                    "event_msg",
                    type="token_count",
                    info=dict(
                        last_token_usage=dict(
                            input_tokens=1000, cached_input_tokens=800, output_tokens=60
                        ),
                        model_context_window=4000,
                    ),
                ),
            ],
        )
        result = m.summarize(path, self.home)
        self.assertEqual(len(result["events"]), 1)
        self.assertEqual(result["reported"]["input"], 1000)
        self.assertEqual(result["reported"]["cached"], 800)
        self.assertTrue(any("reasoning" in note for note in result["notes"]))

    def test_fork_import_stops_at_recorded_boundary_and_compaction_starts_segment(self):
        parent = self.write(
            "parent00",
            [
                self.record("session_meta", id="parent00"),
                self.record("response_item", type="message", role="user", content="before fork"),
            ],
        )
        boundary = parent.stat().st_size
        with parent.open("a") as f:
            f.write(
                json.dumps(
                    self.record(
                        "response_item",
                        type="message",
                        role="user",
                        content="different later branch",
                    )
                )
                + "\n"
            )
        child = self.write(
            "child000",
            [
                self.record(
                    "session_meta",
                    id="child000",
                    history_base=dict(thread_id="parent00", end_byte_offset=boundary),
                ),
                self.record("compacted", message="saved summary"),
                self.record("response_item", type="message", role="user", content="after compact"),
            ],
        )
        result = m.summarize(child, self.home)
        self.assertEqual(result["files"], 2)
        self.assertEqual(result["latest_segment"], 1)
        self.assertNotIn("different later branch", str(result["events"]))
        self.assertEqual([e["segment"] for e in result["events"]], [0, 1, 1])

    def test_instruction_snapshots_replace_and_protected_text_is_not_exposed(self):
        path = self.write(
            "world000",
            [
                self.record("session_meta", base_instructions=dict(text="private runtime words")),
                self.record("world_state", state=dict(agents_md="old instructions")),
                self.record("world_state", state=dict(agents_md="new instructions")),
            ],
        )
        result = m.summarize(path, self.home)
        self.assertEqual(result["persistent"]["world:agents_md"], "2")
        self.assertNotIn("private runtime words", str(result["events"]))
        self.assertNotIn("new instructions", str(result["events"]))
        preview = m.detail(dict(source=str(path), line=1), self.home)
        self.assertNotIn("private runtime words", preview["text"])

    def test_partial_tail_retries_and_media_payload_is_not_counted_as_text(self):
        path = self.write(
            "partial0",
            [
                self.record(
                    "response_item",
                    type="message",
                    role="user",
                    content=[
                        dict(type="input_image", image_url="data:image/png;base64," + "A" * 300000)
                    ],
                )
            ],
        )
        with path.open("a") as f:
            f.write('{"type":"response_item"')
        result = m.summarize(path, self.home)
        self.assertLess(result["events"][0]["tokens"], 20)
        self.assertTrue(any("incomplete" in n for n in result["notes"]))
        self.assertTrue(any("Image/audio" in n for n in result["notes"]))

    def test_redaction_and_source_boundary(self):
        secret = "sk-" + "a" * 40
        self.assertNotIn(secret, accounting.redact("key " + secret))
        self.assertNotIn("secret-value", accounting.redact('{"access_token":"secret-value"}'))
        self.assertNotIn("secret-value", accounting.redact("TYPESAFE_API_KEY=secret-value"))
        outside = self.home / "credentials.jsonl"
        outside.write_text("private")
        with self.assertRaises(ValueError):
            m.detail(dict(source=str(outside), line=1), self.home)

    def test_compaction_replacement_preview_and_opaque_summary(self):
        path = self.write(
            "compact0",
            [
                self.record(
                    "compacted",
                    message="",
                    replacement_history=[
                        dict(type="message", role="developer", content="private instructions"),
                        dict(type="message", role="user", content="retained prompt"),
                        dict(type="compaction", encrypted_content="opaque payload"),
                        dict(type="additional_tools", tools=[dict(name="example")]),
                    ],
                )
            ],
        )
        result = m.summarize(path, self.home)
        prompt = next(e for e in result["events"] if e["category"] == "user")
        self.assertEqual(
            m.detail(dict(source=str(path), line=1, field=prompt["field"]), self.home)["text"],
            "retained prompt",
        )
        self.assertNotIn(
            "private instructions",
            m.detail(dict(source=str(path), line=1, field="replacement:0"), self.home)["text"],
        )
        self.assertNotIn("opaque payload", str(result))
        self.assertTrue(any("summary is opaque" in n for n in result["notes"]))
        self.assertEqual(result["events"][-1]["category"], "tools")

    def test_serialized_tool_media_is_omitted(self):
        output = json.dumps(
            dict(
                content=[
                    dict(type="image", data="A" * 300000),
                    dict(type="text", text="visible text"),
                ]
            )
        )
        self.assertLess(len(accounting.visible_text(output)), 100)
        self.assertIn("visible text", accounting.visible_text(output))

    def test_folder_and_recency_do_not_silently_choose_a_session(self):
        candidates = [
            dict(id="first000", path="/unused/first.jsonl", name="first", cwd="/repo"),
            dict(id="second00", path="/unused/second.jsonl", name="second", cwd="/repo"),
        ]
        with patch.object(codex, "candidates", return_value=candidates):
            path, choices, reason, _ = m.resolve(dict(cwd="/repo"), self.home)
        self.assertIsNone(path)
        self.assertEqual(len(choices), 2)
        self.assertIn("Choose", reason)

    def test_named_continuation_resolves_leaf_without_guessing_independent_names(self):
        parent = self.write("parent00", [self.record("session_meta", id="parent00")])
        child = self.write(
            "child000", [self.record("session_meta", id="child000", forked_from_id="parent00")]
        )
        candidates = [
            dict(id="parent00", path=str(parent), name="Named session"),
            dict(id="child000", path=str(child), name="Named session"),
        ]
        with patch.object(codex, "candidates", return_value=candidates):
            path, _, _, _ = m.resolve(dict(title="Named session | repository"), self.home)
        self.assertEqual(path, child)
        independent = self.write("other000", [self.record("session_meta", id="other000")])
        candidates.append(dict(id="other000", path=str(independent), name="Named session"))
        with patch.object(codex, "candidates", return_value=candidates):
            path, _, _, _ = m.resolve(dict(title="Named session"), self.home)
        self.assertIsNone(path)

    def test_claude_usage_and_private_thinking(self):
        a = accounting.Accounting()
        claude.consume(
            a,
            dict(
                type="assistant",
                message=dict(
                    model="example",
                    usage=dict(
                        input_tokens=10, cache_read_input_tokens=20, cache_creation_input_tokens=30
                    ),
                    content=[
                        dict(type="thinking", thinking="private reasoning"),
                        dict(type="text", text="reply"),
                    ],
                ),
            ),
            "test",
            1,
        )
        self.assertEqual(a.reported["input"], 60)
        self.assertEqual(len(a.events), 1)
        self.assertNotIn("private reasoning", str(a.events))


if __name__ == "__main__":
    unittest.main()
