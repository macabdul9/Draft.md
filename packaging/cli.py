from __future__ import annotations

import argparse
import functools
import fcntl
import hmac
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
from urllib.error import URLError
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen
import webbrowser

from local_models import LocalServers
from agent_processes import AgentProcesses, prepared_writing
from model_files import browse_model, inspect_model

APP_DIR = Path(__file__).resolve().parent


def metadata() -> dict:
    return json.loads((APP_DIR / "version.json").read_text())


def runtime_dir() -> Path:
    default = Path(metadata()["install_dir"]) / "runtime"
    return Path(os.environ.get("DRAFT_DATA_DIR", str(default))).expanduser()


def read_state() -> dict | None:
    try:
        return json.loads((runtime_dir() / "server.json").read_text())
    except FileNotFoundError:
        return None


def request_server(state: dict, stop: bool = False) -> dict | None:
    url = f"http://127.0.0.1:{state['port']}/_dmd/{'stop' if stop else 'status'}"
    request = Request(url, method="POST" if stop else "GET")
    if stop:
        request.add_header("X-Draft-Token", state["token"])
    try:
        with urlopen(request, timeout=2) as response:
            result = json.load(response)
            return result if result.get("instance") == state["instance"] else None
    except (URLError, TimeoutError, OSError, ValueError):
        return None


class AppRequestHandler(SimpleHTTPRequestHandler):
    def __init__(
        self,
        *args,
        app_dir: Path,
        state: dict,
        local_servers: LocalServers,
        agents: AgentProcesses,
        **kwargs,
    ):
        self.app_dir = app_dir.resolve()
        self.state = state
        self.local_servers = local_servers
        self.agents = agents
        super().__init__(*args, directory=str(self.app_dir), **kwargs)

    def allowed_host(self) -> bool:
        expected = f"127.0.0.1:{self.state['port']}"
        if self.headers.get("Host") != expected:
            self.send_error(403, "Use the launch URL printed by Draft.md.")
            return False
        return True

    def send_json(self, value: dict, status: int = 200) -> None:
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if not self.allowed_host():
            return
        path = urlsplit(self.path).path
        if path == "/_dmd/bridge":
            if self.headers.get("X-Draft-Client") != "1" or not self.allowed_origin():
                self.send_error(403)
                return
            self.send_json({"token": self.state["token"], "version": 1})
            return
        if path == "/_dmd/agents":
            if self.authorized():
                self.send_json(self.agents.snapshot())
            return
        if path == "/_dmd/models":
            if self.authorized():
                self.send_json(self.local_servers.snapshot())
            return
        if path == "/_dmd/status":
            self.send_json(
                {
                    "app": "Draft.md",
                    "instance": self.state["instance"],
                    "version": self.state["version"],
                }
            )
            return
        super().do_GET()

    def allowed_origin(self) -> bool:
        expected = f"http://127.0.0.1:{self.state['port']}"
        return self.headers.get("Origin") in (None, expected) and self.headers.get(
            "Sec-Fetch-Site"
        ) not in ("cross-site", "same-site")

    def authorized(self) -> bool:
        if not self.allowed_origin() or not hmac.compare_digest(
            self.headers.get("X-Draft-Token", "").encode(), self.state["token"].encode()
        ):
            self.send_error(403)
            return False
        return True

    def do_HEAD(self) -> None:
        if self.allowed_host():
            super().do_HEAD()

    def stream_writing(
        self, payload: dict, download: bool = False, agent: bool = False
    ) -> None:
        if agent:
            events = self.agents.stream(
                payload.get("provider", ""),
                payload.get("requestId", ""),
                payload.get("prompt", ""),
                payload.get("context", ""),
                payload.get("selection", ""),
            )
        elif download:
            events = self.local_servers.pull(
                payload["engine"], payload.get("model", "")
            )
        else:
            events = self.local_servers.stream(
                payload["engine"],
                payload.get("model", ""),
                payload.get("prompt", ""),
                payload.get("context", ""),
                payload.get("selection", ""),
            )
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            try:
                for event in events:
                    self.wfile.write((json.dumps(event) + "\n").encode())
                    self.wfile.flush()
            except (ValueError, OSError) as error:
                self.wfile.write((json.dumps({"error": str(error)}) + "\n").encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            events.close()

    def do_POST(self) -> None:
        if not self.allowed_host():
            return
        if not self.authorized():
            return
        path = urlsplit(self.path).path
        if path.startswith(("/_dmd/models/", "/_dmd/agents/")):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if (
                    not 0 < length <= 65536
                    or self.headers.get_content_type() != "application/json"
                ):
                    raise ValueError("Send a JSON request smaller than 64 KB.")
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("Send a JSON object.")
                if path.startswith("/_dmd/agents/"):
                    if path == "/_dmd/agents/cancel":
                        request_id = payload.get("requestId", "")
                        if (
                            not isinstance(request_id, str)
                            or not 16 <= len(request_id) <= 80
                        ):
                            raise ValueError("Invalid writing request identifier.")
                        self.agents.cancel(request_id)
                        self.send_json({"cancelled": True})
                    elif path == "/_dmd/agents/prepare":
                        self.send_json(
                            {
                                "text": prepared_writing(
                                    payload.get("prompt", ""),
                                    payload.get("context", ""),
                                    payload.get("selection", ""),
                                )
                            }
                        )
                    elif path == "/_dmd/agents/generate-stream":
                        self.stream_writing(payload, agent=True)
                    else:
                        self.send_error(404)
                    return
                if not isinstance(payload.get("engine"), str):
                    raise ValueError("Choose an inference engine.")
                for field in ("model", "executable", "baseUrl", "apiKey"):
                    if field in payload and not isinstance(payload[field], str):
                        raise ValueError(f"{field} must be text.")
                engine = payload["engine"]
                if path == "/_dmd/models/start":
                    result = self.local_servers.start(engine, payload)
                elif path == "/_dmd/models/connect":
                    result = self.local_servers.connect(engine, payload)
                elif path == "/_dmd/models/stop":
                    result = self.local_servers.stop(engine)
                elif path == "/_dmd/models/inspect":
                    result = inspect_model(payload.get("model", ""), engine)
                elif path == "/_dmd/models/browse":
                    selected = browse_model(engine)
                    result = (
                        inspect_model(selected, engine)
                        if selected
                        else {"cancelled": True}
                    )
                elif path == "/_dmd/models/select":
                    result = self.local_servers.select(engine, payload.get("model", ""))
                elif path == "/_dmd/models/pull-stream":
                    self.stream_writing(payload, download=True)
                    return
                elif path == "/_dmd/models/generate-stream":
                    self.stream_writing(payload)
                    return
                elif path == "/_dmd/models/generate":
                    result = self.local_servers.generate(
                        engine,
                        payload.get("model", ""),
                        payload.get("prompt", ""),
                        payload.get("context", ""),
                        payload.get("selection", ""),
                    )
                else:
                    self.send_error(404)
                    return
                self.send_json(result)
            except (ValueError, OSError) as error:
                self.send_json({"error": str(error)}, status=400)
            return
        if path != "/_dmd/stop":
            self.send_error(404)
            return
        self.send_json({"instance": self.state["instance"], "stopping": True})
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def translate_path(self, request_path: str) -> str:
        decoded = unquote(urlsplit(request_path).path)
        if "\x00" in decoded:
            return str(self.app_dir / ".missing-file")
        target = (self.app_dir / decoded.lstrip("/")).resolve()
        if not target.is_relative_to(self.app_dir):
            return str(self.app_dir / ".missing-file")
        return str(target)

    def list_directory(self, path: str):
        self.send_error(404)
        return None

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def serve(port: int) -> None:
    info = metadata()
    folder = runtime_dir()
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (folder / "server.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    state = {
        "port": port,
        "pid": os.getpid(),
        "token": secrets.token_hex(32),
        "instance": secrets.token_hex(16),
        "version": info["version"],
    }
    local_servers = LocalServers()
    agents = AgentProcesses()
    handler = functools.partial(
        AppRequestHandler,
        app_dir=APP_DIR / "dist",
        state=state,
        local_servers=local_servers,
        agents=agents,
    )
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    temporary = folder / "server.next.json"
    temporary.write_text(json.dumps(state))
    temporary.chmod(0o600)
    temporary.replace(folder / "server.json")
    try:

        def shutdown(_signum: int, _frame: object) -> None:
            threading.Thread(target=server.shutdown, daemon=True).start()

        signal.signal(signal.SIGTERM, shutdown)
        signal.signal(signal.SIGINT, shutdown)
        server.serve_forever()
    finally:
        agents.close()
        local_servers.close()
        server.server_close()
        current = read_state()
        if current and current.get("instance") == state["instance"]:
            (folder / "server.json").unlink(missing_ok=True)
        lock.close()


def start(port: int | None, open_browser: bool) -> None:
    state = read_state()
    live = bool(state and request_server(state))
    if port is None:
        port = state["port"] if live else 4387
    if not 1024 <= port <= 65535:
        raise ValueError("Choose a port between 1024 and 65535.")
    if live:
        if state["port"] != port:
            raise ValueError(
                f"Draft.md is already running on port {state['port']}. Stop it before changing ports."
            )
    else:
        folder = runtime_dir()
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (folder / "server.log").open("a") as log:
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(APP_DIR / "cli.py"),
                    "_serve",
                    "--port",
                    str(port),
                ],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
                start_new_session=True,
            )
        for _ in range(50):
            if process.poll() is not None:
                raise OSError(
                    f"Could not start on port {port}. See {folder / 'server.log'}."
                )
            state = read_state()
            if state and state.get("pid") == process.pid and request_server(state):
                break
            time.sleep(0.1)
        else:
            process.terminate()
            raise OSError("Server startup timed out.")
    url = f"http://127.0.0.1:{port}"
    print(f"Draft.md is running at {url}")
    if open_browser and not webbrowser.open(url):
        print("Open the URL above in your browser.")


def stop() -> None:
    state = read_state()
    if not state or not request_server(state):
        print("Draft.md is not running.")
        return
    if not request_server(state, stop=True):
        raise OSError("The server did not accept the shutdown request.")
    for _ in range(180):
        if not request_server(state) and read_state() is None:
            print(
                "Draft.md stopped. Browser workspace data and local notes were retained."
            )
            return
        time.sleep(0.1)
    raise OSError("The server is still shutting down. Try status again.")


def uninstall(confirmed: bool) -> None:
    if not confirmed:
        raise ValueError(
            "Save your work, then run 'draft.md uninstall --yes'. This removes only app files and launchers."
        )
    stop()
    info = metadata()
    install_dir = Path(info["install_dir"])
    if install_dir == Path.home() or not (install_dir / "current").is_symlink():
        raise ValueError("Installation location is invalid; refusing to remove it.")
    for name in ("draft.md", "dmd", "draftmd"):
        command = Path(info["bin_dir"]) / name
        if command.is_symlink() and command.resolve().is_relative_to(
            install_dir.resolve()
        ):
            command.unlink()
    # App-only files; never recurse over arbitrary files in a configured parent directory.
    for folder in ("versions", "runtime"):
        target = install_dir / folder
        if target.is_symlink():
            target.unlink()
        elif target.exists():
            shutil.rmtree(target)
    for filename in ("current", "current.next", "launcher.sh"):
        (install_dir / filename).unlink(missing_ok=True)
    print("Draft.md uninstalled. Local notes and browser site data were retained.")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="draft.md",
        description="Your work, in Markdown. Launch the local app and manage its installation.",
    )
    parser.add_argument(
        "--version", action="version", version=f"Draft.md {metadata()['version']}"
    )
    commands = parser.add_subparsers(dest="command")
    for name in ("start", "run", "open", "restart", "_serve"):
        command = commands.add_parser(name)
        command.add_argument(
            "--port", type=int, help="Default: existing server's port, otherwise 4387."
        )
        command.add_argument(
            "--no-open",
            action="store_true",
            help="Start without opening a browser window.",
        )
    for name in ("stop", "status", "doctor", "version", "update"):
        commands.add_parser(name)
    remove = commands.add_parser("uninstall")
    remove.add_argument("--yes", action="store_true")
    args = parser.parse_args(sys.argv[1:] or ["start"])
    try:
        if args.command in ("start", "run", "open", "restart"):
            if args.command == "restart":
                state = read_state()
                if args.port is None and state:
                    args.port = state["port"]
                stop()
            start(args.port, not args.no_open)
        elif args.command == "_serve":
            serve(args.port or 4387)
        elif args.command == "stop":
            stop()
        elif args.command == "status":
            state = read_state()
            live = request_server(state) if state else None
            print(
                f"Running Draft.md {live['version']} at http://127.0.0.1:{state['port']}"
                if live
                else "Draft.md is not running."
            )
        elif args.command == "doctor":
            print(f"Python: {sys.version.split()[0]}")
            print(f"App: {APP_DIR}")
            print(
                f"Static build: {'present' if (APP_DIR / 'dist/index.html').exists() else 'missing'}"
            )
            print(f"Runtime data: {runtime_dir()}")
            print(
                "Notes are opened through the browser folder picker; the launcher never reads them."
            )
        elif args.command == "version":
            print(f"Draft.md {metadata()['version']}")
        elif args.command == "update":
            info = metadata()
            subprocess.run(
                [
                    sys.executable,
                    str(APP_DIR / "installer.py"),
                    "--base-url",
                    info["release_base"],
                    "--install-dir",
                    info["install_dir"],
                    "--bin-dir",
                    info["bin_dir"],
                ],
                check=True,
            )
            print(
                "Save your work, then run 'draft.md restart' to use the new app. Close app tabs to activate a waiting browser update."
            )
        elif args.command == "uninstall":
            uninstall(args.yes)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Draft.md: {error}\n")


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        raise SystemExit("Draft.md requires Python 3.10+.")
    main()
