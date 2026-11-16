import json
import tempfile
import unittest
from pathlib import Path

import reader_test_support  # noqa: F401
from reader import service as m


class SnapshotContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name).resolve()
        self.path = self.home / ".grok/sessions/workspace/session/chat_history.jsonl"
        self.path.parent.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, text):
        self.path.write_text(json.dumps(dict(type="user", content=text)) + "\n")

    def test_a_preview_cannot_read_replacement_text_from_an_old_event_locator(self):
        self.write("original prompt")
        event = m.summarize(self.path, self.home)["events"][0]
        self.write("replacement prompt")
        request = dict(event, record_hash=event.get("record_hash", "missing"))
        try:
            result = m.detail(request, self.home)
        except ValueError as error:
            self.assertEqual(getattr(error, "code", None), "stale_event")
        else:
            self.fail(f"stale preview was accepted: {result}")

    def test_appending_a_record_keeps_the_original_event_reference_valid(self):
        self.write("original prompt")
        event = m.summarize(self.path, self.home)["events"][0]
        self.assertTrue(event.get("record_hash"))
        with self.path.open("a") as stream:
            stream.write(json.dumps(dict(type="user", content="later prompt")) + "\n")
        self.assertEqual(m.detail(event, self.home)["text"], "original prompt")


if __name__ == "__main__":
    unittest.main()
