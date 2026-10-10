from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agent_processes import AgentProcesses, prepared_writing


class AgentProcessTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="draft-cli-fixture-")
        self.addCleanup(temporary.cleanup)
        self.executable = Path(temporary.name) / "agent"
        self.executable.write_text(
            f"#!{sys.executable}\n"
            + Path(__file__).with_name("fixtures").joinpath("agent_cli.py").read_text()
        )
        self.executable.chmod(0o700)
        self.agents = AgentProcesses()
        self.addCleanup(self.agents.close)
        lookup = patch(
            "agent_processes.shutil.which", return_value=str(self.executable)
        )
        lookup.start()
        self.addCleanup(lookup.stop)

    def test_both_clis_stream_and_finish_without_duplicate_text(self) -> None:
        for provider in ("codex", "claudecode"):
            with self.subTest(provider=provider):
                events = self.agents.stream(
                    provider, str(uuid.uuid4()), "Write a checkbox"
                )
                self.assertEqual(next(events), {"delta": "- [ ] "})
                remaining = list(events)
                self.assertEqual(remaining[0], {"delta": "Local writing"})
                self.assertEqual(
                    remaining[-1], {"done": True, "text": "- [ ] Local writing"}
                )
                self.assertFalse(self.agents.processes)

    def test_cancel_stops_a_silent_cli_and_cleans_up(self) -> None:
        for provider in ("codex", "claudecode"):
            request_id = str(uuid.uuid4())
            events = self.agents.stream(provider, request_id, "WAIT")
            self.assertIn("progress", next(events))
            process = self.agents.processes[request_id]
            self.agents.cancel(request_id)
            with self.assertRaises(ValueError):
                list(events)
            self.assertIsNotNone(process.poll())
            self.assertFalse(self.agents.processes)

    def test_failures_and_missing_installations_are_actionable(self) -> None:
        for provider in ("codex", "claudecode"):
            with self.assertRaisesRegex(ValueError, "could not finish"):
                list(self.agents.stream(provider, str(uuid.uuid4()), "FAIL"))
        with patch("agent_processes.shutil.which", return_value=None):
            with self.assertRaisesRegex(ValueError, "Install codex"):
                list(self.agents.stream("codex", str(uuid.uuid4()), "Write"))
        with self.assertRaisesRegex(ValueError, "local CLI"):
            list(self.agents.stream("chatgpt", str(uuid.uuid4()), "Write"))

    def test_cancellation_before_start_and_prompt_boundaries(self) -> None:
        request_id = str(uuid.uuid4())
        self.agents.cancel(request_id)
        with self.assertRaises(ValueError):
            list(self.agents.stream("codex", request_id, "Write"))
        prompt = prepared_writing("Write todos", "x" * 9000)
        self.assertIn("Draft.md capabilities", prompt)
        self.assertNotIn("x" * 6001, prompt)
        self.assertTrue(prompt.endswith("Write todos"))
        with self.assertRaises(ValueError):
            prepared_writing("")


if __name__ == "__main__":
    unittest.main()
