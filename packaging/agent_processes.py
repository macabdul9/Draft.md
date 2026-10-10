from __future__ import annotations

import json
import os
import queue
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time

from writing_harness import writing_messages, writing_result

PROVIDERS = {"codex": "codex", "claudecode": "claude"}


def prepared_writing(prompt: str, context: str = "", selection: str = "") -> str:
    messages = writing_messages(prompt, context, selection)
    return "\n\n".join(message["content"] for message in messages)


def stop_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=1)
    except ProcessLookupError:
        return
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=2)


class AgentProcesses:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.processes: dict[str, subprocess.Popen] = {}
        self.closed = False
        self.cancelled: set[str] = set()

    def snapshot(self) -> dict:
        return {
            name: {"installed": bool(shutil.which(command)), "command": command}
            for name, command in PROVIDERS.items()
        }

    def cancel(self, request_id: str) -> None:
        with self.lock:
            self.cancelled.add(request_id)
            if len(self.cancelled) > 256:
                self.cancelled.pop()
            process = self.processes.get(request_id)
        if process:
            stop_process(process)

    def close(self) -> None:
        with self.lock:
            self.closed = True
            processes = list(self.processes.values())
        for process in processes:
            stop_process(process)

    def stream(
        self,
        provider: str,
        request_id: str,
        prompt: str,
        context: str = "",
        selection: str = "",
    ):
        if provider not in PROVIDERS:
            raise ValueError("Choose Codex or Claude Code for a local CLI request.")
        if not isinstance(request_id, str) or not re.fullmatch(
            r"[a-zA-Z0-9-]{16,80}", request_id
        ):
            raise ValueError("Invalid writing request identifier.")
        messages = writing_messages(prompt, context, selection)
        executable = shutil.which(PROVIDERS[provider])
        if not executable:
            raise ValueError(
                f"Install {PROVIDERS[provider]} and sign in once in your terminal, then restart Draft.md."
            )
        with tempfile.TemporaryDirectory(prefix="draft-writing-") as folder:
            if provider == "codex":
                command = [executable, "app-server", "--stdio"]
                for override in (
                    "features.shell_tool=false",
                    "features.unified_exec=false",
                    "features.apps=false",
                    "features.hooks=false",
                    "features.multi_agent=false",
                    "features.memories=false",
                    "mcp_servers={}",
                    'web_search="disabled"',
                    "project_doc_max_bytes=0",
                    "notify=[]",
                ):
                    command.extend(["-c", override])
            else:
                command = [
                    executable,
                    "-p",
                    "--output-format",
                    "stream-json",
                    "--verbose",
                    "--include-partial-messages",
                    "--tools",
                    "",
                    "--strict-mcp-config",
                    "--mcp-config",
                    '{"mcpServers":{}}',
                    "--setting-sources",
                    "",
                    "--disable-slash-commands",
                    "--no-session-persistence",
                    "--system-prompt",
                    messages[0]["content"],
                ]
                # Newer Claude Code provides a stronger customization boundary while retaining login.
                help_result = subprocess.run(
                    [executable, "--help"], capture_output=True, text=True, timeout=10
                )
                if "--safe-mode" in help_result.stdout:
                    command.append("--safe-mode")
            with self.lock:
                if (
                    self.closed
                    or request_id in self.processes
                    or request_id in self.cancelled
                ):
                    raise ValueError(
                        "This writing request is already active or Draft.md is stopping."
                    )
                process = subprocess.Popen(
                    command,
                    cwd=folder,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
                self.processes[request_id] = process
            events: queue.Queue = queue.Queue(maxsize=128)
            stopped = threading.Event()

            def read_events() -> None:
                while not stopped.is_set():
                    line = process.stdout.readline(1024 * 1024 + 1)
                    while not stopped.is_set():
                        try:
                            events.put(line, timeout=0.2)
                            break
                        except queue.Full:
                            continue
                    if not line or len(line) > 1024 * 1024:
                        return

            reader = threading.Thread(target=read_events, daemon=True)
            reader.start()

            def send(value: dict) -> None:
                process.stdin.write((json.dumps(value) + "\n").encode())
                process.stdin.flush()

            text = ""
            deadline = time.monotonic() + 300
            try:
                if provider == "codex":
                    send(
                        {
                            "id": 1,
                            "method": "initialize",
                            "params": {
                                "clientInfo": {"name": "draft_md", "version": "0.0.1"}
                            },
                        }
                    )
                else:
                    content = "\n\n".join(
                        message["content"] for message in messages[1:]
                    )
                    process.stdin.write(content.encode())
                    process.stdin.close()
                while time.monotonic() < deadline:
                    try:
                        line = events.get(timeout=1)
                    except queue.Empty:
                        yield {
                            "progress": f"Waiting for {'Codex' if provider == 'codex' else 'Claude Code'}…"
                        }
                        continue
                    if not line:
                        raise ValueError(
                            "The agent stopped before completing. Check its terminal login and account access."
                        )
                    if len(line) > 1024 * 1024:
                        raise ValueError("The agent returned an oversized event.")
                    item = json.loads(line)
                    delta = ""
                    if provider == "codex":
                        if item.get("error"):
                            raise ValueError(
                                "Codex rejected the request. Check CLI login, configuration, and model access."
                            )
                        if item.get("id") == 1:
                            send({"method": "initialized", "params": {}})
                            send(
                                {
                                    "id": 2,
                                    "method": "thread/start",
                                    "params": {
                                        "cwd": folder,
                                        "ephemeral": True,
                                        "sandbox": "read-only",
                                        "approvalPolicy": "never",
                                        "baseInstructions": messages[0]["content"],
                                        "developerInstructions": "Writing only. Never invoke tools. Return only the requested Markdown.",
                                    },
                                }
                            )
                        elif item.get("id") == 2:
                            thread_id = item["result"]["thread"]["id"]
                            send(
                                {
                                    "id": 3,
                                    "method": "turn/start",
                                    "params": {
                                        "threadId": thread_id,
                                        "input": [
                                            {
                                                "type": "text",
                                                "text": "\n\n".join(
                                                    m["content"] for m in messages[1:]
                                                ),
                                            }
                                        ],
                                    },
                                }
                            )
                        elif item.get("method") == "item/agentMessage/delta":
                            delta = item["params"]["delta"]
                        elif item.get("method") == "turn/completed":
                            turn = item.get("params", {}).get("turn", {})
                            if turn.get("status") != "completed":
                                raise ValueError(
                                    "Codex could not finish writing. Check its terminal login and account limits."
                                )
                            yield {"done": True, "text": writing_result(text)}
                            return
                        elif "id" in item and "method" in item:
                            # Any requested tool or approval fails closed rather than gaining permissions.
                            send(
                                {
                                    "id": item["id"],
                                    "error": {
                                        "code": -32601,
                                        "message": "Writing-only session; tools are disabled.",
                                    },
                                }
                            )
                        elif item.get("method") == "error":
                            if not item.get("params", {}).get("willRetry", False):
                                raise ValueError(
                                    "Codex reported an error. Check CLI login and account access."
                                )
                    else:
                        if item.get("type") == "stream_event":
                            event = item.get("event", {})
                            if (
                                event.get("type") == "content_block_delta"
                                and event.get("delta", {}).get("type") == "text_delta"
                            ):
                                delta = event["delta"]["text"]
                        elif item.get("type") == "result":
                            if item.get("is_error"):
                                raise ValueError(
                                    "Claude Code could not finish writing. Check its terminal login and account limits."
                                )
                            if not text and isinstance(item.get("result"), str):
                                text = item["result"]
                                yield {"delta": text}
                            yield {"done": True, "text": writing_result(text)}
                            return
                    if delta:
                        if not isinstance(delta, str):
                            raise ValueError("The agent returned invalid writing.")
                        text += delta
                        if len(text) > 65536:
                            raise ValueError(
                                "The draft exceeds the 64 KB writing limit."
                            )
                        yield {"delta": delta}
                raise ValueError(
                    "The agent timed out. Partial writing was kept; try again."
                )
            except (json.JSONDecodeError, KeyError, TypeError, BrokenPipeError):
                raise ValueError(
                    "The agent stream failed. Check your CLI version and login, then try again."
                ) from None
            finally:
                stopped.set()
                stop_process(process)
                process.stdout.close()
                if not process.stdin.closed:
                    process.stdin.close()
                reader.join(timeout=2)
                with self.lock:
                    self.processes.pop(request_id, None)
