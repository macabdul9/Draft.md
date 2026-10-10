from __future__ import annotations

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main() -> None:
    arguments = sys.argv[1:]
    if "--port" in arguments:
        port = int(arguments[arguments.index("--port") + 1])
    else:
        port = int(os.environ["OLLAMA_HOST"].rsplit(":", 1)[1])
    if any(str(value).endswith("/slow") for value in arguments):
        time.sleep(30)
    if any(str(value).endswith("/crash") for value in arguments):
        print("Failed to load model", flush=True)
        raise SystemExit(7)
    if any(str(value).endswith("/workers") for value in arguments):
        worker = subprocess.Popen(
            [
                sys.executable,
                "-c",
                "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)",
            ]
        )
        Path(arguments[1]).joinpath("worker.pid").write_text(str(worker.pid))
    print("Authorization: Bearer test-secret", flush=True)

    installed = ["local-test"]

    class ModelRequest(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path not in ("/v1/models", "/api/tags"):
                self.send_error(404)
                return
            data = json.dumps(
                {
                    "models": [
                        {"name": name, "details": {"parameter_size": "2.69B"}}
                        for name in installed
                    ],
                    "data": [{"id": "local-test"}],
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self) -> None:
            payload = json.loads(
                self.rfile.read(int(self.headers.get("Content-Length", "0")))
            )
            if self.path == "/api/pull":
                installed.append(payload["model"])
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson")
                self.end_headers()
                for event in (
                    {"status": "pulling", "completed": 50, "total": 100},
                    {"status": "success"},
                ):
                    self.wfile.write((json.dumps(event) + "\n").encode())
                    self.wfile.flush()
                return
            if self.path == "/api/show":
                result = {"model_info": {"general.parameter_count": 2697198592}}
            else:
                text = "Draft: " + payload["messages"][-1]["content"]
                result = (
                    {"message": {"content": text}}
                    if self.path == "/api/chat"
                    else {"choices": [{"message": {"content": text}}]}
                )
            if payload.get("stream"):
                self.send_response(200)
                self.send_header(
                    "Content-Type",
                    "application/x-ndjson"
                    if self.path == "/api/chat"
                    else "text/event-stream",
                )
                self.end_headers()
                for part in (text[:7], text[7:]):
                    item = (
                        {"message": {"content": part}, "done": False}
                        if self.path == "/api/chat"
                        else {"choices": [{"delta": {"content": part}}]}
                    )
                    line = json.dumps(item) + "\n"
                    if self.path != "/api/chat":
                        line = "data: " + line + "\n"
                    self.wfile.write(line.encode())
                    self.wfile.flush()
                    time.sleep(0.05)
                self.wfile.write(
                    b'{"done":true}\n'
                    if self.path == "/api/chat"
                    else b"data: [DONE]\n\n"
                )
                self.wfile.flush()
                return
            data = json.dumps(result).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    HTTPServer.allow_reuse_address = True
    HTTPServer(("127.0.0.1", port), ModelRequest).serve_forever()


if __name__ == "__main__":
    main()
