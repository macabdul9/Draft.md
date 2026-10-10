from __future__ import annotations

import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from test_local_models import gguf, weights, models
from model_files import CATALOG, browse_model, inspect_model


class ModelSelectionTests(unittest.TestCase):
    def test_catalog_default_and_all_candidates_fit_budget(self) -> None:
        self.assertEqual(CATALOG["default"], "LiquidAI/LFM2.5-2.6B")
        self.assertEqual(len(CATALOG["models"]), 5)
        self.assertTrue(
            all(0 < entry["parameters"] <= 4000000000 for entry in CATALOG["models"])
        )

    def test_counts_weights_and_gguf_independently_of_filename(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            weights(folder, 2697198592)
            self.assertEqual(
                inspect_model(str(folder), "sglang")["parameters"], 2697198592
            )
            path = folder / "tiny-1b.gguf"
            gguf(path, 7000000000)
            with self.assertRaisesRegex(ValueError, "7.00B"):
                inspect_model(str(path), "llama.cpp")
            weights(folder, 4000000001)
            with self.assertRaisesRegex(ValueError, "4B or smaller"):
                inspect_model(str(folder), "vllm-engine")
            gguf(path, 4000000000)
            self.assertEqual(
                inspect_model(str(path), "llama.cpp")["parameters"], 4000000000
            )

    def test_invalid_truncated_and_oversized_headers_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            file = folder / "test.gguf"
            file.write_bytes(b"GGUF")
            with self.assertRaisesRegex(ValueError, "truncated"):
                inspect_model(str(file), "llama.cpp")
            (folder / "model.safetensors").write_bytes(struct.pack("<Q", 2**63))
            with self.assertRaisesRegex(ValueError, "inspection limit"):
                inspect_model(str(folder), "sglang")
            header = json.dumps({"weight": {"dtype": "I32", "shape": [100]}}).encode()
            (folder / "model.safetensors").write_bytes(
                struct.pack("<Q", len(header)) + header
            )
            with self.assertRaisesRegex(ValueError, "Packed quantized"):
                inspect_model(str(folder), "sglang")

    def test_cancelled_native_picker_does_not_select_a_path(self) -> None:
        with (
            patch("model_files.subprocess.run") as run,
            patch("model_files.sys.platform", "darwin"),
        ):
            run.return_value.returncode = 1
            self.assertIsNone(browse_model("llama.cpp"))
            self.assertEqual(run.call_args.args[0][0], "osascript")

    def test_ollama_filters_large_and_unknown_parameter_counts(self) -> None:
        self.assertIsNone(models.parameter_size("25.2B"))
        self.assertIsNone(models.parameter_size("unknown"))
        self.assertEqual(models.parameter_size("494.03M"), 494030000)
        self.assertEqual(models.parameter_size("4B"), 4000000000)

    def test_selection_requires_verified_size_and_available_model(self) -> None:
        servers = models.LocalServers()
        self.addCleanup(servers.close)
        servers.entries["ollama"] = {
            "state": "running",
            "models": ["alias"],
            "owned": False,
            "baseUrl": "http://127.0.0.1:11434",
        }
        for count, allowed in [(2697198592, True), (7000000000, False), (None, False)]:
            response = unittest.mock.MagicMock()
            response.__enter__.return_value.read.return_value = json.dumps(
                {"model_info": {"general.parameter_count": count}}
            ).encode()
            with patch.object(models, "build_opener") as opener:
                opener.return_value.open.return_value = response
                if allowed:
                    self.assertEqual(
                        servers.select("ollama", "alias")["engines"]["ollama"][
                            "selectedModel"
                        ],
                        "alias",
                    )
                else:
                    with self.assertRaisesRegex(ValueError, "4B or smaller"):
                        servers.select("ollama", "alias")
        with self.assertRaisesRegex(ValueError, "available model"):
            servers.select("ollama", "missing")


if __name__ == "__main__":
    unittest.main()
