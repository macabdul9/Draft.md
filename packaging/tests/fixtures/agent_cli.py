from __future__ import annotations

import json
from pathlib import Path
import sys
import time


def emit(value: dict) -> None:
    print(json.dumps(value), flush=True)


def main() -> None:
    if "--help" in sys.argv:
        print("--safe-mode")
        return
    if "app-server" in sys.argv:
        assert "features.shell_tool=false" in sys.argv
        assert "mcp_servers={}" in sys.argv
        for line in sys.stdin:
            value = json.loads(line)
            if value.get("method") == "initialize":
                emit({"id": 1, "result": {}})
            elif value.get("method") == "thread/start":
                config = value["params"]
                assert config["ephemeral"]
                assert config["sandbox"] == "read-only"
                assert config["approvalPolicy"] == "never"
                assert Path(config["cwd"]).name.startswith("draft-writing-")
                assert "Draft.md capabilities" in config["baseInstructions"]
                emit({"id": 2, "result": {"thread": {"id": "test-thread"}}})
            elif value.get("method") == "turn/start":
                prompt = value["params"]["input"][0]["text"]
                if "WAIT" in prompt:
                    time.sleep(60)
                if "FAIL" in prompt:
                    emit(
                        {
                            "method": "turn/completed",
                            "params": {"turn": {"status": "failed"}},
                        }
                    )
                    return
                emit(
                    {"method": "item/agentMessage/delta", "params": {"delta": "- [ ] "}}
                )
                time.sleep(0.1)
                emit(
                    {
                        "method": "item/agentMessage/delta",
                        "params": {"delta": "Local writing"},
                    }
                )
                emit(
                    {
                        "method": "turn/completed",
                        "params": {"turn": {"status": "completed"}},
                    }
                )
                return
    else:
        assert sys.argv[sys.argv.index("--tools") + 1] == ""
        assert "--strict-mcp-config" in sys.argv
        assert "--safe-mode" in sys.argv
        prompt = sys.stdin.read()
        if "WAIT" in prompt:
            time.sleep(60)
        if "FAIL" in prompt:
            emit({"type": "result", "is_error": True})
            return
        for text in ("- [ ] ", "Local writing"):
            emit(
                {
                    "type": "stream_event",
                    "event": {
                        "type": "content_block_delta",
                        "delta": {"type": "text_delta", "text": text},
                    },
                }
            )
            time.sleep(0.1)
        emit({"type": "result", "is_error": False, "result": "- [ ] Local writing"})


if __name__ == "__main__":
    main()
