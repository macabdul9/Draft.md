from __future__ import annotations

import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packaging"))
spec = importlib.util.spec_from_file_location(
    "draft_local_models", ROOT / "packaging/local_models.py"
)
models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(models)


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def weights(folder: Path, count: int = 2697198592) -> None:
    header = json.dumps(
        {"weight": {"shape": [count], "dtype": "BF16", "data_offsets": [0, count * 2]}}
    ).encode()
    (folder / "model.safetensors").write_bytes(struct.pack("<Q", len(header)) + header)


def gguf(path: Path, count: int = 2697198592) -> None:
    name = b"weight"
    path.write_bytes(
        b"GGUF"
        + struct.pack("<IQQ", 3, 1, 0)
        + struct.pack("<Q", len(name))
        + name
        + struct.pack("<IQIQ", 1, count, 1, 0)
    )


class LocalModelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="draft models ")
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.executable = self.folder / "fake engine"
        fixture = (ROOT / "packaging/tests/fixtures/model_server.py").read_text()
        self.executable.write_text(f"#!{sys.executable}\n" + fixture)
        self.executable.chmod(0o700)
        self.model = self.folder / "model"
        self.model.mkdir()
        weights(self.model)
        self.gguf = self.folder / "test.gguf"
        gguf(self.gguf)
        self.servers = models.LocalServers()
        self.addCleanup(self.servers.close)

    def config(self, engine: str, **changes) -> dict:
        return {
            "executable": str(self.executable),
            "port": free_port(),
            "model": str(self.gguf if engine == "llama.cpp" else self.model),
            **changes,
        }

    def wait_state(self, engine: str, state: str, seconds: int = 6) -> dict:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            entry = self.servers.snapshot()["engines"][engine]
            if entry["state"] == state:
                return entry
            time.sleep(0.05)
        self.fail(f"Expected {engine} to become {state}: {entry}")

    def test_pull_default_reports_progress_and_verifies_model(self) -> None:
        self.servers.start("ollama", self.config("ollama"))
        self.wait_state("ollama", "running")
        model = "LiquidAI/lfm2.5-2.6b:q4_k_m"
        events = list(self.servers.pull("ollama", model))
        self.assertEqual(
            events[0], {"progress": "pulling", "completed": 50, "total": 100}
        )
        self.assertTrue(events[-1]["done"])
        self.assertEqual(
            self.servers.snapshot()["engines"]["ollama"]["selectedModel"], model
        )
        with self.assertRaisesRegex(ValueError, "at or below 4B"):
            list(self.servers.pull("ollama", "large:26b"))

    def test_stream_all_engines_delivers_chunks_before_completion(self) -> None:
        for engine in models.ENGINES:
            with self.subTest(engine=engine):
                self.servers.start(engine, self.config(engine))
                self.wait_state(engine, "running")
                events = self.servers.stream(engine, "local-test", "Write a story")
                first = next(events)
                self.assertEqual(first, {"delta": "Draft: "})
                remaining = list(events)
                self.assertEqual(
                    remaining[-1], {"done": True, "text": "Draft: Write a story"}
                )
                self.assertEqual(remaining[0], {"delta": "Write a story"})
                self.servers.stop(engine)

    def test_stopped_runtime_can_restart_immediately_on_same_port(self) -> None:
        config = self.config("ollama")
        self.servers.start("ollama", config)
        self.wait_state("ollama", "running")
        self.servers.select("ollama", "local-test")
        self.servers.stop("ollama")
        self.servers.start("ollama", config)
        self.wait_state("ollama", "running")

    def test_generate_with_owned_servers_and_require_verified_model(self) -> None:
        for engine in models.ENGINES:
            with self.subTest(engine=engine):
                self.servers.start(engine, self.config(engine))
                self.wait_state(engine, "running")
                with self.assertRaisesRegex(ValueError, "available model"):
                    self.servers.generate(engine, "missing", "Write a short note")
                with self.assertRaisesRegex(ValueError, "instruction"):
                    self.servers.generate(engine, "local-test", "")
                result = self.servers.generate(
                    engine, "local-test", "Write a short note"
                )
                self.assertEqual(result["text"], "Draft: Write a short note")
                self.servers.stop(engine)

    def test_start_discover_stop_all_four_engines_and_redact_logs(self) -> None:
        for engine in models.ENGINES:
            with self.subTest(engine=engine):
                self.servers.start(engine, self.config(engine))
                running = self.wait_state(engine, "running")
                self.assertTrue(running["owned"])
                self.assertEqual(running["models"], ["local-test"])
                with self.assertRaisesRegex(ValueError, "already active"):
                    self.servers.start(engine, self.config(engine))
                process = self.servers.entries[engine]["process"]
                self.servers.stop(engine)
                self.assertIsNotNone(process.returncode)
                self.assertEqual(
                    self.servers.snapshot()["engines"][engine]["state"], "stopped"
                )
                logs = "\n".join(self.servers.snapshot()["engines"][engine]["logs"])
                self.assertNotIn("test-secret", logs)
                with self.assertRaises(OSError):
                    urlopen(running["baseUrl"] + "/models", timeout=1)

    def test_startup_cancellation_crash_and_port_conflict(self) -> None:
        slow = self.folder / "slow"
        slow.mkdir()
        weights(slow)
        self.servers.start("sglang", self.config("sglang", model=str(slow)))
        self.servers.stop("sglang")
        self.assertEqual(
            self.servers.snapshot()["engines"]["sglang"]["state"], "stopped"
        )
        crash = self.folder / "crash"
        crash.mkdir()
        weights(crash)
        self.servers.start("sglang", self.config("sglang", model=str(crash)))
        self.assertIn("code 7", self.wait_state("sglang", "error")["error"])
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            with self.assertRaisesRegex(ValueError, "already in use"):
                self.servers.start(
                    "ollama", self.config("ollama", port=listener.getsockname()[1])
                )
            self.assertGreater(listener.getsockname()[1], 0)

    def test_external_disconnect_and_bridge_shutdown_do_not_stop_server(self) -> None:
        owner = models.LocalServers()
        self.addCleanup(owner.close)
        config = self.config("sglang")
        owner.start("sglang", config)
        deadline = time.monotonic() + 6
        while owner.snapshot()["engines"]["sglang"]["state"] != "running":
            self.assertLess(time.monotonic(), deadline)
            time.sleep(0.05)
        url = f"http://127.0.0.1:{config['port']}/v1"
        self.servers.connect("sglang", {"baseUrl": url, "apiKey": "session-only"})
        report = self.servers.snapshot()["engines"]["sglang"]
        self.assertFalse(report["owned"])
        self.assertNotIn("session-only", json.dumps(report))
        self.servers.stop("sglang")
        self.assertEqual(models.discover_models("sglang", url), ["local-test"])
        self.servers.connect("sglang", {"baseUrl": url})
        self.servers.close()
        self.assertEqual(models.discover_models("sglang", url), ["local-test"])
        with self.assertRaisesRegex(ValueError, "shutting down"):
            self.servers.start("ollama", self.config("ollama"))

    def test_local_models_only_and_arguments_are_not_shell_commands(self) -> None:
        for engine in ("llama.cpp", "vllm-engine", "sglang"):
            with self.assertRaisesRegex(ValueError, "existing local model"):
                models.launch_command(
                    engine, self.config(engine, model="vendor/remote-model")
                )
        model = self.folder / "weights $(touch should-not-exist)"
        model.mkdir()
        weights(model)
        command, environment, _ = models.launch_command(
            "vllm-engine", self.config("vllm-engine", model=str(model))
        )
        self.assertIn(str(model.resolve()), command)
        self.assertEqual(environment["HF_HUB_OFFLINE"], "1")
        self.assertFalse((self.folder / "should-not-exist").exists())
        for port in (True, "8000", 80, 65536):
            with self.assertRaisesRegex(ValueError, "Port"):
                models.launch_command("ollama", self.config("ollama", port=port))
        with self.assertRaisesRegex(ValueError, "not installed"):
            models.launch_command(
                "ollama", self.config("ollama", executable="/missing/ollama")
            )

    def test_timeout_stops_owned_process(self) -> None:
        slow = self.folder / "slow"
        slow.mkdir()
        weights(slow)
        self.servers.start("sglang", self.config("sglang", model=str(slow), timeout=10))
        entry = self.wait_state("sglang", "error", seconds=15)
        self.assertIn("timed out", entry["error"])
        self.assertIsNotNone(self.servers.entries["sglang"]["process"].returncode)

    def test_endpoint_validation_and_redirects_do_not_forward_keys(self) -> None:
        for url in (
            "http://remote.example/v1",
            "file:///tmp/model",
            "https://user:pass@example.com",
            "https://example.com/v1?key=secret",
        ):
            with self.assertRaises(ValueError):
                models.endpoint_url(url)
        self.assertEqual(
            models.endpoint_url("http://127.0.0.1:8000/v1/"), "http://127.0.0.1:8000/v1"
        )
        requests = []

        class Redirect(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                requests.append(self.path)
                self.send_response(302)
                self.send_header("Location", "/stolen-key")
                self.end_headers()

        server = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaisesRegex(ValueError, "redirects"):
                models.discover_models(
                    "ollama", f"http://127.0.0.1:{server.server_port}", "secret"
                )
            self.assertEqual(requests, ["/api/tags"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_stop_also_terminates_stubborn_workers(self) -> None:
        workers = self.folder / "workers"
        workers.mkdir()
        weights(workers)
        self.servers.start("sglang", self.config("sglang", model=str(workers)))
        self.wait_state("sglang", "running")
        worker_pid = int((workers / "worker.pid").read_text())
        self.servers.stop("sglang")
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            status = subprocess.run(
                ["ps", "-o", "stat=", "-p", str(worker_pid)],
                capture_output=True,
                text=True,
                check=False,
            ).stdout.strip()
            if not status or status.startswith("Z"):
                return
            time.sleep(0.05)
        self.fail(f"Worker {worker_pid} survived server shutdown: {status}")


if __name__ == "__main__":
    unittest.main()
