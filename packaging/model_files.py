from __future__ import annotations

import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import sys
from typing import BinaryIO

CATALOG = json.loads(Path(__file__).with_name("model_catalog.json").read_text())
MAX_PARAMETERS = CATALOG["maxParameters"]
HEADER_LIMIT = 64 * 1024 * 1024


def read_exact(stream: BinaryIO, size: int) -> bytes:
    if size < 0 or stream.tell() + size > HEADER_LIMIT:
        raise ValueError("Model metadata exceeds the inspection limit.")
    data = stream.read(size)
    if len(data) != size:
        raise ValueError("Model metadata is truncated.")
    return data


def number(stream: BinaryIO, format: str) -> int:
    return struct.unpack("<" + format, read_exact(stream, struct.calcsize(format)))[0]


def skip_string(stream: BinaryIO) -> None:
    read_exact(stream, number(stream, "Q"))


def skip_value(stream: BinaryIO, kind: int) -> None:
    widths = {0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8}
    if kind in widths:
        read_exact(stream, widths[kind])
    elif kind == 8:
        skip_string(stream)
    elif kind == 9:
        element_kind = number(stream, "I")
        length = number(stream, "Q")
        if length > 2000000 or element_kind == 9:
            raise ValueError("Unsupported GGUF metadata array.")
        if element_kind in widths:
            read_exact(stream, length * widths[element_kind])
        else:
            for _ in range(length):
                skip_value(stream, element_kind)
    else:
        raise ValueError("Unsupported GGUF metadata type.")


def gguf_parameters(path: Path) -> int:
    with path.open("rb") as stream:
        if read_exact(stream, 4) != b"GGUF" or number(stream, "I") not in (2, 3):
            raise ValueError("Choose a valid GGUF v2/v3 model.")
        tensors, metadata = number(stream, "Q"), number(stream, "Q")
        if not 0 < tensors <= 200000 or metadata > 100000:
            raise ValueError("Unsupported GGUF header.")
        for _ in range(metadata):
            key = read_exact(stream, number(stream, "Q"))
            kind = number(stream, "I")
            if key == b"split.count":
                if kind not in (2, 4, 10):
                    raise ValueError("Unsupported split-model metadata.")
                if number(stream, {2: "H", 4: "I", 10: "Q"}[kind]) != 1:
                    raise ValueError(
                        "Split GGUF models cannot be checked as a single file."
                    )
            else:
                skip_value(stream, kind)
        total = 0
        for _ in range(tensors):
            skip_string(stream)
            dimensions = number(stream, "I")
            if not 1 <= dimensions <= 4:
                raise ValueError("Invalid GGUF tensor dimensions.")
            shape = [number(stream, "Q") for _ in range(dimensions)]
            if not all(0 < dimension <= 1000000000000 for dimension in shape):
                raise ValueError("Invalid GGUF tensor shape.")
            total += math.prod(shape)
            read_exact(stream, 12)
        return total


def safetensors_parameters(folder: Path) -> int:
    files = sorted(folder.glob("*.safetensors"))
    if not files or len(files) > 1024:
        raise ValueError("Choose a model folder containing Safetensors weights.")
    index = folder / "model.safetensors.index.json"
    if index.exists():
        if index.stat().st_size > HEADER_LIMIT:
            raise ValueError("Model index exceeds the inspection limit.")
        metadata = json.loads(index.read_bytes())
        mapping = metadata.get("weight_map", {}) if isinstance(metadata, dict) else None
        if (
            not isinstance(mapping, dict)
            or not mapping
            or not all(isinstance(value, str) for value in mapping.values())
            or set(mapping.values()) != {path.name for path in files}
        ):
            raise ValueError(
                "Model shards are missing or extra weight files are present. Choose one complete model directory."
            )
    elif len(files) != 1:
        raise ValueError(
            "Multiple Safetensors files require a complete model.safetensors.index.json."
        )
    total = 0
    names: set[str] = set()
    for path in files:
        with path.open("rb") as stream:
            header = json.loads(read_exact(stream, number(stream, "Q")))
        if not isinstance(header, dict):
            raise ValueError("Invalid Safetensors metadata.")
        for name, tensor in header.items():
            if name == "__metadata__":
                continue
            if name in names:
                raise ValueError(
                    "Duplicate tensors found. Choose one complete model, without extra weight copies."
                )
            names.add(name)
            shape = tensor.get("shape") if isinstance(tensor, dict) else None
            if (
                not isinstance(shape, list)
                or len(shape) > 8
                or not all(type(size) is int and size > 0 for size in shape)
            ):
                raise ValueError("Invalid Safetensors tensor shape.")
            if tensor.get("dtype") in (
                "I8",
                "U8",
                "I16",
                "U16",
                "I32",
                "U32",
                "I64",
                "U64",
            ):
                raise ValueError(
                    "Packed quantized Safetensors cannot be counted reliably. Use a GGUF model or original weights."
                )
            total += math.prod(shape)
    return total


def inspect_model(value: str, engine: str) -> dict:
    if engine not in ("llama.cpp", "vllm-engine", "sglang"):
        raise ValueError(
            "Choose llama.cpp for a GGUF file or vLLM/SGLang for a model directory."
        )
    if not value.strip():
        raise ValueError("Choose a local model path first.")
    path = Path(value).expanduser().resolve()
    if engine == "llama.cpp":
        if not path.is_file() or path.suffix.lower() != ".gguf":
            raise ValueError("Choose an existing .gguf model file.")
        if "-of-" in path.stem:
            raise ValueError(
                "Split GGUF models are not supported by the 4B size check. Choose a single-file model."
            )
        count = gguf_parameters(path)
    else:
        if not path.is_dir():
            raise ValueError("Choose an existing local model directory.")
        count = safetensors_parameters(path)
    if not 0 < count <= MAX_PARAMETERS:
        raise ValueError(
            f"This model has {count / 1e9:.2f}B parameters. Local models must be 4B or smaller."
        )
    return {"path": str(path), "parameters": count, "label": path.name}


def browse_model(engine: str) -> str | None:
    if engine not in ("llama.cpp", "vllm-engine", "sglang"):
        raise ValueError(
            "Use llama.cpp for GGUF files, or vLLM/SGLang for model directories."
        )
    if sys.platform == "darwin":
        choice = (
            'choose file with prompt "Choose a GGUF model (4B or smaller)"'
            if engine == "llama.cpp"
            else 'choose folder with prompt "Choose a model directory (4B or smaller)"'
        )
        command = ["osascript", "-e", f"POSIX path of ({choice})"]
    elif shutil.which("zenity"):
        command = [
            "zenity",
            "--file-selection",
            "--title=Choose a local model (4B or smaller)",
        ]
        command += (
            ["--file-filter=GGUF models | *.gguf"]
            if engine == "llama.cpp"
            else ["--directory"]
        )
    else:
        raise ValueError(
            "A native picker is unavailable. Paste the full model path instead."
        )
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=120, check=False
        )
    except subprocess.TimeoutExpired:
        raise ValueError(
            "Model picker timed out. Try Browse again or paste a path."
        ) from None
    if result.returncode:
        return None
    return result.stdout.strip() or None
