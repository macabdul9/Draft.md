from __future__ import annotations

import importlib.util
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import subprocess
import shutil
import ssl
import sys
import tarfile
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


installer = load_module("draft_installer", ROOT / "packaging/installer.py")
stats = load_module("draft_stats", ROOT / "scripts/download-stats.py")


class InstallationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="draft cli tests ")
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.install_dir = self.folder / "app files"
        self.bin_dir = self.folder / "commands"
        self.archive = self.folder / "release.tar.gz"
        payload = self.folder / "draft-md"
        (payload / "dist").mkdir(parents=True)
        (payload / "dist/index.html").write_text("<h1>Your work, in Markdown.</h1>")
        (payload / "dist/test.js").write_text("console.log('Draft.md');")
        (payload / "version.json").write_text(json.dumps({"version": "1.0.0"}))
        (payload / "LICENSE").write_text("MIT License")
        for name in ("cli.py", "installer.py", "shell-helpers.sh"):
            (payload / name).write_bytes((ROOT / "packaging" / name).read_bytes())
        with tarfile.open(self.archive, "w:gz") as archive:
            archive.add(payload, arcname="draft-md")

    def install(self) -> None:
        installer.install(
            self.archive, self.install_dir, self.bin_dir, installer.RELEASE_BASE
        )

    def cli(self, *args: str, check: bool = True) -> subprocess.CompletedProcess:
        return subprocess.run(
            [str(self.bin_dir / "dmd"), *args],
            text=True,
            capture_output=True,
            check=check,
            timeout=15,
        )

    def test_installs_aliases_and_does_not_replace_unrelated_commands(self) -> None:
        self.bin_dir.mkdir()
        (self.bin_dir / "dmd").write_text("an unrelated command")
        with self.assertRaisesRegex(ValueError, "unrelated command"):
            self.install()
        self.assertEqual((self.bin_dir / "dmd").read_text(), "an unrelated command")
        self.assertFalse(self.install_dir.exists())

    @unittest.skipUnless(
        shutil.which("curl") and shutil.which("openssl"),
        "curl and openssl are required",
    )
    def test_curl_pipe_installer_downloads_and_verifies_a_release_over_https(
        self,
    ) -> None:
        certificate = self.folder / "test-cert.pem"
        key = self.folder / "test-key.pem"
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-keyout",
                str(key),
                "-out",
                str(certificate),
                "-subj",
                "/CN=127.0.0.1",
                "-addext",
                "subjectAltName=IP:127.0.0.1",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        filename = "draft-md-1.0.0.tar.gz"
        (self.folder / filename).write_bytes(self.archive.read_bytes())
        (self.folder / "installer.py").write_bytes(
            (ROOT / "packaging/installer.py").read_bytes()
        )
        (self.folder / "install.sh").write_bytes((ROOT / "install.sh").read_bytes())
        (self.folder / "release.json").write_text(
            json.dumps(
                {
                    "archive": filename,
                    "sha256": hashlib.sha256(self.archive.read_bytes()).hexdigest(),
                }
            )
        )
        handler = functools.partial(
            SimpleHTTPRequestHandler, directory=str(self.folder)
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certificate, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"https://127.0.0.1:{server.server_port}"
            environment = {
                **os.environ,
                "DRAFT_RELEASE_BASE": url,
                "CURL_CA_BUNDLE": str(certificate),
                "SSL_CERT_FILE": str(certificate),
                "NO_PROXY": "127.0.0.1,localhost",
            }
            result = subprocess.run(
                [
                    "bash",
                    "-c",
                    'set -euo pipefail; curl -fsSL "$1/install.sh" | bash -s -- --install-dir "$2" --bin-dir "$3"',
                    "bash",
                    url,
                    str(self.install_dir),
                    str(self.bin_dir),
                ],
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Installed Draft.md", result.stdout)
            self.assertIn("Draft.md 1.0.0", self.cli("version").stdout)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_archive_rejects_traversal_symlinks_and_devices(self) -> None:
        for filename, kind in [
            ("draft-md/../escape", tarfile.REGTYPE),
            ("draft-md/link", tarfile.SYMTYPE),
            ("draft-md/device", tarfile.CHRTYPE),
        ]:
            with tarfile.open(self.archive, "w:gz") as archive:
                member = tarfile.TarInfo(filename)
                member.type = kind
                member.linkname = "/etc/passwd"
                archive.addfile(member)
            with self.assertRaisesRegex(ValueError, "unsafe"):
                installer.extract_archive(self.archive, self.folder / "extract")
        self.assertFalse((self.folder / "escape").exists())

    def test_version_doctor_reinstall_and_optional_shell_helpers(self) -> None:
        self.install()
        self.install()
        for alias in ("draft.md", "dmd", "draftmd"):
            result = subprocess.run(
                [str(self.bin_dir / alias), "--version"],
                text=True,
                capture_output=True,
                check=True,
            )
            self.assertIn("Draft.md 1.0.0", result.stdout)
        self.assertIn("Static build: present", self.cli("doctor").stdout)
        environment = {
            **os.environ,
            "PATH": str(self.bin_dir) + os.pathsep + os.environ["PATH"],
        }
        helpers = self.install_dir / "current/shell-helpers.sh"
        result = subprocess.run(
            [
                "bash",
                "-c",
                'source "$1"; start draft.md --help; run dmd --help',
                "bash",
                str(helpers),
            ],
            env=environment,
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertIn("--no-open", result.stdout)

    def test_start_reuse_status_http_security_stop_and_uninstall(self) -> None:
        self.install()
        notes = self.folder / "personal notes.md"
        notes.write_text("Keep my work.")
        # Let the OS select a free port, then exercise the real installed launcher.
        import socket

        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        self.addCleanup(
            lambda: self.cli("stop", check=False)
            if (self.bin_dir / "dmd").exists()
            else None
        )
        self.cli("start", "--no-open", "--port", str(port))
        state_path = self.install_dir / "runtime/server.json"
        state = json.loads(state_path.read_text())
        self.assertEqual(state_path.stat().st_mode & 0o777, 0o600)
        self.cli("run", "--no-open", "--port", str(port))
        self.cli("open", "--no-open")
        self.assertEqual(json.loads(state_path.read_text())["pid"], state["pid"])
        self.assertIn("Running Draft.md", self.cli("status").stdout)
        url = f"http://127.0.0.1:{port}"
        with urlopen(url, timeout=2) as response:
            self.assertIn(b"Your work", response.read())
        with urlopen(url + "/test.js", timeout=2) as response:
            self.assertIn("javascript", response.headers["Content-Type"])
        for path in (
            "/../cli.py",
            "/%2e%2e/cli.py",
            "/%2e%2e/%2e%2e/personal%20notes.md",
        ):
            with self.assertRaises(HTTPError) as raised:
                urlopen(url + path, timeout=2)
            self.assertEqual(raised.exception.code, 404)
            raised.exception.close()
        for request in (
            Request(url, headers={"Host": "evil.example"}),
            Request(url + "/_dmd/stop", method="POST"),
            Request(
                url + "/_dmd/stop",
                method="POST",
                headers={
                    "X-Draft-Token": state["token"],
                    "Origin": "https://evil.example",
                },
            ),
        ):
            with self.assertRaises(HTTPError) as raised:
                urlopen(request, timeout=2)
            self.assertEqual(raised.exception.code, 403)
            raised.exception.close()
        self.cli("stop")
        self.assertIn("not running", self.cli("status").stdout)
        self.assertNotEqual(self.cli("uninstall", check=False).returncode, 0)
        self.cli("uninstall", "--yes")
        self.assertEqual(notes.read_text(), "Keep my work.")
        self.assertFalse((self.bin_dir / "dmd").exists())
        self.assertFalse((self.install_dir / "versions").exists())

    def test_checksum_failure_leaves_installation_untouched(self) -> None:
        def fake_download(url: str, target: Path, limit: int = 0) -> None:
            if url.endswith("release.json"):
                target.write_text(
                    json.dumps({"archive": "draft-md-1.0.0.tar.gz", "sha256": "0" * 64})
                )
            else:
                target.write_bytes(self.archive.read_bytes())

        with (
            patch.object(installer, "download", fake_download),
            patch.object(
                sys,
                "argv",
                [
                    "installer",
                    "--install-dir",
                    str(self.install_dir),
                    "--bin-dir",
                    str(self.bin_dir),
                ],
            ),
        ):
            with self.assertRaises(SystemExit) as raised:
                installer.main()
        self.assertEqual(raised.exception.code, 1)
        self.assertFalse(self.install_dir.exists())


class DownloadStatisticsTests(unittest.TestCase):
    def test_keeps_downloads_distinct_from_active_users_and_rejects_overlap(
        self,
    ) -> None:
        source = {
            "channel": "extension-store",
            "metric": "cumulative-downloads",
            "count": 12,
            "source_url": "https://example.com/report",
            "observed_at": "2026-10-07",
            "non_overlapping": True,
        }
        self.assertEqual(stats.aggregate_sources(8, [source])[0], 20)
        for changed in (
            {"metric": "active-users"},
            {"non_overlapping": False},
            {"count": -1},
            {"channel": "github-release-assets"},
        ):
            with self.assertRaises(ValueError):
                stats.aggregate_sources(8, [{**source, **changed}])

    def test_paginates_and_does_not_count_installer_helpers_twice(self) -> None:
        app = {
            "assets": [
                {"name": "draft-md-1.0.0.tar.gz", "download_count": 7},
                {"name": "install.sh", "download_count": 99},
                {"name": "installer.py", "download_count": 99},
            ]
        }
        pages = [
            [app] + [{"assets": []}] * 99,
            [
                {
                    "assets": [
                        {"name": "draft-md-extension-1.0.0.zip", "download_count": 3}
                    ]
                }
            ],
        ]
        with patch.object(
            stats,
            "urlopen",
            side_effect=[io.BytesIO(json.dumps(page).encode()) for page in pages],
        ) as fetch:
            self.assertEqual(stats.release_downloads(), (10, True))
            self.assertEqual(fetch.call_count, 2)


if __name__ == "__main__":
    unittest.main()
