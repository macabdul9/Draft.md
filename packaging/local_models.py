from __future__ import annotations

from collections import deque
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from model_files import MAX_PARAMETERS, inspect_model
from writing_harness import ollama_writing_payload, writing_messages, writing_result

ENGINES = {
    "ollama": {"name": "Ollama", "command": "ollama", "port": 11434},
    "llama.cpp": {"name": "llama.cpp", "command": "llama-server", "port": 8080},
    "vllm-engine": {"name": "vLLM", "command": "vllm", "port": 8000},
    "sglang": {"name": "SGLang", "command": "sglang", "port": 30000},
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Server redirects are not followed. Enter the final API URL.")


def endpoint_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(
            "Use an API URL without credentials, query parameters, or fragments."
        )
    try:
        local = (
            parsed.hostname == "localhost"
            or ipaddress.ip_address(parsed.hostname or "").is_loopback
        )
    except ValueError:
        local = False
    if not parsed.hostname or parsed.scheme not in ("http", "https"):
        raise ValueError("Enter an HTTP or HTTPS API URL.")
    if parsed.scheme == "http" and not local:
        raise ValueError(
            "Remote connections require HTTPS. Use an SSH tunnel for HTTP servers."
        )
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError("Invalid server port.")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def discover_models(engine: str, base_url: str, api_key: str = "") -> list[str]:
    path = "/api/tags" if engine == "ollama" else "/models"
    request = Request(base_url + path, headers={"Accept": "application/json"})
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")
    opener = build_opener(NoRedirect(), ProxyHandler({}))
    try:
        with opener.open(request, timeout=3) as response:
            data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise ValueError("Model discovery response is too large.")
        payload = json.loads(data)
        items = payload.get("models" if engine == "ollama" else "data")
        field = "name" if engine == "ollama" else "id"
        if not isinstance(items, list):
            raise ValueError("The server returned an unsupported model list.")
        return [
            item[field]
            for item in items
            if isinstance(item, dict)
            and isinstance(item.get(field), str)
            and (
                engine != "ollama"
                or parameter_size(item.get("details", {}).get("parameter_size", ""))
                is not None
            )
        ][:500]
    except HTTPError as error:
        error.close()
        if error.code in (401, 403):
            raise ValueError(
                "Authentication failed. Check the server API key."
            ) from None
        raise ValueError(
            f"Model discovery failed (HTTP {error.code}). Check the API base URL."
        ) from None
    except (URLError, TimeoutError, OSError):
        raise ValueError(
            "Cannot reach the server. Check its address and whether it is running."
        ) from None
    except (json.JSONDecodeError, AttributeError):
        raise ValueError("The server did not return a valid model list.") from None


def parameter_size(label: str) -> int | None:
    if not isinstance(label, str):
        return None
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([BMK])\s*", label, re.IGNORECASE)
    if not match:
        return None
    count = int(float(match[1]) * {"B": 1e9, "M": 1e6, "K": 1e3}[match[2].upper()])
    return count if 0 < count <= MAX_PARAMETERS else None


def integer(value: object, label: str, minimum: int, maximum: int) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not minimum <= value <= maximum
    ):
        raise ValueError(f"{label} must be between {minimum} and {maximum}.")
    return value


def launch_command(engine: str, config: dict) -> tuple[list[str], dict, str]:
    preset = ENGINES[engine]
    executable = config.get("executable", "").strip() or preset["command"]
    resolved = shutil.which(str(Path(executable).expanduser()))
    if not resolved:
        raise ValueError(
            f"{preset['command']} is not installed or not on PATH. Install the runtime or choose its executable in Advanced."
        )
    port = integer(config.get("port", preset["port"]), "Port", 1024, 65535)
    environment = dict(os.environ)
    # These launches must never fetch model weights implicitly.
    environment.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    if engine == "ollama":
        environment["OLLAMA_HOST"] = f"127.0.0.1:{port}"
        environment["OLLAMA_NO_CLOUD"] = "1"
        environment["OLLAMA_CONTEXT_LENGTH"] = "4096"
        environment["OLLAMA_MAX_LOADED_MODELS"] = "1"
        environment["OLLAMA_NUM_PARALLEL"] = "1"
        return [resolved, "serve"], environment, f"http://127.0.0.1:{port}"
    model = Path(config.get("model", "")).expanduser()
    if not config.get("model") or not model.exists():
        raise ValueError(
            "Choose an existing local model path. Model downloads are not automatic."
        )
    if engine == "llama.cpp" and (
        not model.is_file() or model.suffix.lower() != ".gguf"
    ):
        raise ValueError("llama.cpp needs a local .gguf model file.")
    if engine != "llama.cpp" and not model.is_dir():
        raise ValueError(
            "Choose the local model directory containing its configuration and weights."
        )
    inspect_model(str(model), engine)
    if engine == "llama.cpp":
        command = [
            resolved,
            "-m",
            str(model.resolve()),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ]
    else:
        command = [
            resolved,
            "serve",
            str(model.resolve()),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ]
    if config.get("contextLength", 4096) is not None:
        context = integer(
            config.get("contextLength", 4096), "Context length", 128, 1048576
        )
        flag = {
            "llama.cpp": "--ctx-size",
            "vllm-engine": "--max-model-len",
            "sglang": "--context-length",
        }[engine]
        command.extend([flag, str(context)])
    return command, environment, f"http://127.0.0.1:{port}/v1"


class LocalServers:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.entries: dict[str, dict] = {}
        self.closed = False

    def snapshot(self) -> dict:
        with self.lock:
            engines = {}
            for engine, preset in ENGINES.items():
                entry = self.entries.get(engine, {})
                engines[engine] = {
                    **preset,
                    "available": bool(shutil.which(preset["command"])),
                    "state": entry.get("state", "stopped"),
                    "owned": entry.get("owned", False),
                    "baseUrl": entry.get("baseUrl", ""),
                    "models": entry.get("models", []),
                    "selectedModel": entry.get("selectedModel", ""),
                    "modelPath": entry.get("modelPath", ""),
                    "parameters": entry.get("parameters"),
                    "error": entry.get("error", ""),
                    "logs": list(entry.get("logs", [])),
                }
            return {"engines": engines}

    def connect(self, engine: str, config: dict) -> dict:
        base_url = endpoint_url(config.get("baseUrl", ""))
        key = config.get("apiKey", "")
        if not isinstance(key, str) or "\n" in key or "\r" in key:
            raise ValueError("Invalid API key.")
        with self.lock:
            self._ensure_idle(engine)
            # Reserve the engine while the network check is in progress.
            entry = {
                "state": "starting",
                "owned": False,
                "baseUrl": base_url,
                "logs": deque(maxlen=100),
            }
            self.entries[engine] = entry
        try:
            models = discover_models(engine, base_url, key)
        except ValueError as error:
            with self.lock:
                if self.entries.get(engine) is entry and entry["state"] == "starting":
                    entry.update(state="error", error=str(error))
            raise
        with self.lock:
            if self.closed or entry["state"] != "starting":
                raise ValueError("Connection cancelled.")
            entry.update(state="running", models=models, apiKey=key)
        return self.snapshot()

    def _ensure_idle(self, engine: str) -> None:
        if engine not in ENGINES:
            raise ValueError("Unknown inference engine.")
        if self.closed:
            raise ValueError("Draft.md is shutting down.")
        if self.entries.get(engine, {}).get("state") in (
            "starting",
            "running",
            "stopping",
        ):
            raise ValueError(
                "This engine is already active. Stop or disconnect it first."
            )

    def start(self, engine: str, config: dict) -> dict:
        with self.lock:
            self._ensure_idle(engine)
            command, environment, base_url = launch_command(engine, config)
            inspected = (
                inspect_model(config["model"], engine) if engine != "ollama" else None
            )
            timeout = integer(config.get("timeout", 300), "Startup timeout", 10, 1800)
            port = urlsplit(base_url).port
            with socket.socket() as listener:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    listener.bind(("127.0.0.1", port))
                except OSError:
                    raise ValueError(
                        "That port is already in use. Connect to the existing server or choose another port."
                    ) from None
            process = subprocess.Popen(
                command,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            entry = {
                "state": "starting",
                "owned": True,
                "baseUrl": base_url,
                "process": process,
                "logs": deque(maxlen=100),
                "models": [],
                "modelPath": inspected["path"] if inspected else "",
                "parameters": inspected["parameters"] if inspected else None,
            }
            self.entries[engine] = entry
            threading.Thread(target=self._read_logs, args=(entry,), daemon=True).start()
            threading.Thread(
                target=self._watch, args=(engine, entry, timeout), daemon=True
            ).start()
        return self.snapshot()

    def _read_logs(self, entry: dict) -> None:
        stream = entry["process"].stdout
        try:
            while chunk := stream.readline(2048):
                line = chunk.decode("utf-8", errors="replace").rstrip()
                line = re.sub(
                    r"(?i)(bearer\s+|(?:token|api[_-]?key|password)[=:]\s*)\S+",
                    r"\1[redacted]",
                    line,
                )
                line = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", line)
                with self.lock:
                    entry["logs"].append(line)
        finally:
            stream.close()

    def _watch(self, engine: str, entry: dict, timeout: int) -> None:
        deadline = time.monotonic() + timeout
        while True:
            with self.lock:
                if entry["state"] not in ("starting", "running"):
                    return
                process = entry["process"]
                if self._exited(process):
                    self._terminate(process)
                    code = process.returncode
                    entry.update(
                        state="error",
                        error=f"Server exited (code {code}). Open Logs for details.",
                    )
                    return
                starting = entry["state"] == "starting"
            if starting:
                try:
                    models = discover_models(engine, entry["baseUrl"])
                    with self.lock:
                        if entry["state"] == "starting":
                            entry.update(state="running", models=models)
                            if engine != "ollama" and models:
                                entry["selectedModel"] = models[0]
                except ValueError:
                    if time.monotonic() >= deadline:
                        with self.lock:
                            if (
                                self.entries.get(engine) is entry
                                and entry["state"] == "starting"
                            ):
                                self.stop(engine)
                                entry.update(
                                    state="error",
                                    error="Model loading timed out. Check Logs or increase the startup timeout.",
                                )
                        return
            time.sleep(0.25 if starting else 1)

    @staticmethod
    def _exited(process: subprocess.Popen) -> bool:
        # Keep the leader unreaped until its workers are stopped, preventing PID reuse.
        return (
            process.returncode is not None
            or os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            is not None
        )

    def _terminate(self, process: subprocess.Popen) -> None:
        if process.returncode is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
            deadline = time.monotonic() + 3
            while not self._exited(process) and time.monotonic() < deadline:
                time.sleep(0.05)
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            # macOS can report EPERM for a group containing only an unreaped zombie.
            if not self._exited(process):
                raise
        process.wait(timeout=3)

    def stop(self, engine: str) -> dict:
        with self.lock:
            if engine not in ENGINES:
                raise ValueError("Unknown inference engine.")
            entry = self.entries.get(engine)
            if not entry or entry.get("state") == "stopping":
                return self.snapshot()
            entry["state"] = "stopping"
            process = entry.get("process")
            if process:
                self._terminate(process)
            entry.update(state="stopped", models=[], apiKey="", error="")
        return self.snapshot()

    def select(self, engine: str, model: str) -> dict:
        with self.lock:
            entry = self.entries.get(engine)
            if engine == "ollama" and entry:
                model = next(
                    (
                        name
                        for name in entry.get("models", [])
                        if name.lower() == model.lower()
                    ),
                    model,
                )
            if (
                not entry
                or entry["state"] != "running"
                or model not in entry.get("models", [])
            ):
                raise ValueError("Choose an available model from a running connection.")
            if engine == "ollama":
                request = Request(
                    entry["baseUrl"] + "/api/show",
                    data=json.dumps({"model": model}).encode(),
                    headers={"Content-Type": "application/json"},
                )
                if entry.get("apiKey"):
                    request.add_header("Authorization", "Bearer " + entry["apiKey"])
                try:
                    with build_opener(NoRedirect(), ProxyHandler({})).open(
                        request, timeout=5
                    ) as response:
                        data = response.read(1024 * 1024 + 1)
                    if len(data) > 1024 * 1024:
                        raise ValueError("Model information is too large.")
                    info = json.loads(data).get("model_info", {})
                    counts = [
                        count
                        for key, count in info.items()
                        if key.endswith(".parameter_count") and type(count) is int
                    ]
                    if not counts or max(counts) > MAX_PARAMETERS or min(counts) <= 0:
                        raise ValueError(
                            "Cannot verify this model is 4B or smaller. Choose another installed model."
                        )
                    entry["parameters"] = max(counts)
                except (URLError, OSError, json.JSONDecodeError, AttributeError):
                    raise ValueError(
                        "Could not verify model size with Ollama. Check the server connection."
                    ) from None
            elif not entry.get("owned"):
                raise ValueError(
                    "Parameter size cannot be verified for an external compatible endpoint. Use a local model path for selection."
                )
            entry["selectedModel"] = model
        return self.snapshot()

    def pull(self, engine: str, model: str):
        if engine != "ollama":
            raise ValueError("Automatic model downloads currently require Ollama.")
        catalog = json.loads(Path(__file__).with_name("model_catalog.json").read_text())
        allowed = {
            item["ollama"].lower()
            for item in catalog["models"]
            if item["parameters"] <= MAX_PARAMETERS
        }
        if model.lower() not in allowed:
            raise ValueError(
                "Choose a supported model at or below 4B for automatic download."
            )
        with self.lock:
            entry = self.entries[engine].copy()
        if entry["state"] != "running":
            raise ValueError("Start or connect to Ollama before downloading a model.")
        headers = {"Content-Type": "application/json"}
        if entry.get("apiKey"):
            headers["Authorization"] = "Bearer " + entry["apiKey"]
        request = Request(
            entry["baseUrl"] + "/api/pull",
            data=json.dumps({"model": model, "stream": True}).encode(),
            headers=headers,
        )
        try:
            with build_opener(NoRedirect(), ProxyHandler({})).open(
                request, timeout=120
            ) as response:
                while True:
                    line = response.readline(65537)
                    if not line:
                        raise ValueError(
                            "The model download was interrupted. Invoke the agent again to resume."
                        )
                    if len(line) > 65536:
                        raise ValueError("Ollama returned invalid download progress.")
                    item = json.loads(line)
                    if item.get("error"):
                        raise ValueError(
                            "Model download failed: " + str(item["error"])[:500]
                        )
                    yield {
                        "progress": item.get("status", "Downloading"),
                        "completed": item.get("completed", 0),
                        "total": item.get("total", 0),
                    }
                    if item.get("status") == "success":
                        installed = discover_models(
                            engine, entry["baseUrl"], entry.get("apiKey", "")
                        )
                        with self.lock:
                            self.entries[engine]["models"] = installed
                        self.select(engine, model)
                        yield {"done": True, "text": ""}
                        return
        except (URLError, OSError, UnicodeError, json.JSONDecodeError):
            raise ValueError(
                "Model download failed. Check your connection and Ollama version, then invoke the agent again to resume."
            ) from None

    def generate(
        self,
        engine: str,
        model: str,
        prompt: str,
        context: str = "",
        selection: str = "",
    ) -> dict:
        messages = writing_messages(prompt, context, selection)
        self.select(engine, model)
        with self.lock:
            entry = self.entries[engine].copy()
        payload = {"model": model, "messages": messages, "stream": False}
        if engine == "ollama":
            payload = ollama_writing_payload(model, messages, payload["stream"])
            path = "/api/chat"
        else:
            payload["max_tokens"] = 512
            path = "/chat/completions"
        request = Request(
            entry["baseUrl"] + path,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        if entry.get("apiKey"):
            request.add_header("Authorization", "Bearer " + entry["apiKey"])
        try:
            with build_opener(NoRedirect(), ProxyHandler({})).open(
                request, timeout=120
            ) as response:
                data = response.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                raise ValueError("The generated response exceeds the size limit.")
            result = json.loads(data)
            text = (
                result["message"]["content"]
                if engine == "ollama"
                else result["choices"][0]["message"]["content"]
            )
            return {"text": writing_result(text)}
        except (
            URLError,
            OSError,
            KeyError,
            IndexError,
            TypeError,
            json.JSONDecodeError,
        ):
            raise ValueError(
                "Generation failed. Check that the selected model and server are ready, then try again."
            ) from None

    def stream(self, engine, model, prompt, context="", selection=""):
        messages = writing_messages(prompt, context, selection)
        self.select(engine, model)
        with self.lock:
            entry = self.entries[engine].copy()
        payload = {"model": model, "messages": messages, "stream": True}
        if engine == "ollama":
            payload = ollama_writing_payload(model, messages, payload["stream"])
            path = "/api/chat"
        else:
            payload["max_tokens"] = 512
            path = "/chat/completions"
        headers = {"Content-Type": "application/json"}
        if entry.get("apiKey"):
            headers["Authorization"] = "Bearer " + entry["apiKey"]
        request = Request(
            entry["baseUrl"] + path, data=json.dumps(payload).encode(), headers=headers
        )
        text = ""
        total = 0
        try:
            with build_opener(NoRedirect(), ProxyHandler({})).open(
                request, timeout=120
            ) as response:
                while True:
                    line = response.readline(1024 * 1024 + 1)
                    if not line:
                        raise ValueError(
                            "The writing stream ended early. Your partial draft has been kept."
                        )
                    total += len(line)
                    if total > 1024 * 1024:
                        raise ValueError(
                            "The generated response exceeds the size limit."
                        )
                    line = line.strip()
                    if not line:
                        continue
                    if engine != "ollama":
                        if not line.startswith(b"data:"):
                            continue
                        line = line[5:].strip()
                        if line == b"[DONE]":
                            yield {"done": True, "text": writing_result(text)}
                            return
                    item = json.loads(line)
                    if item.get("error"):
                        raise ValueError(
                            "The inference server reported a generation error."
                        )
                    if engine == "ollama":
                        delta = item.get("message", {}).get("content", "")
                    else:
                        choices = item.get("choices", [])
                        delta = (
                            choices[0].get("delta", {}).get("content", "")
                            if choices
                            else ""
                        )
                    if delta:
                        if not isinstance(delta, str):
                            raise ValueError(
                                "The inference server returned invalid writing."
                            )
                        text += delta
                        yield {"delta": delta}
                    if engine == "ollama" and item.get("done") is True:
                        yield {"done": True, "text": writing_result(text)}
                        return
        except (
            URLError,
            OSError,
            KeyError,
            IndexError,
            TypeError,
            UnicodeError,
            json.JSONDecodeError,
        ):
            raise ValueError(
                "Generation failed. Your partial draft has been kept. Check the inference server and try again."
            ) from None

    def close(self) -> None:
        with self.lock:
            self.closed = True
        for engine in list(self.entries):
            self.stop(engine)
