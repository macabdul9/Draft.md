from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sys
import tarfile
import tempfile
from urllib.request import urlopen

RELEASE_BASE = "https://github.com/macabdul9/Draft.md/releases/latest/download"


def download(url: str, target: Path, limit: int = 100 * 1024 * 1024) -> None:
    with urlopen(url, timeout=60) as response, target.open("wb") as output:
        size = 0
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise ValueError("Release download exceeds the 100 MB limit.")
            output.write(chunk)


def extract_archive(archive: Path, destination: Path) -> Path:
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if (
            len(members) > 10000
            or sum(member.size for member in members) > 250 * 1024 * 1024
        ):
            raise ValueError("Release archive exceeds extraction limits.")
        seen: set[str] = set()
        for member in members:
            parts = member.name.split("/")
            if (
                parts[0] != "draft-md"
                or any(part in ("", ".", "..") for part in parts)
                or "\\" in member.name
                or member.name in seen
                or not (member.isfile() or member.isdir())
            ):
                raise ValueError("Release archive contains an unsafe path or link.")
            seen.add(member.name)
        for member in members:
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                source = bundle.extractfile(member)
                if source is None:
                    raise ValueError("Invalid release archive member.")
                with source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
    root = destination / "draft-md"
    for required in (
        "cli.py",
        "installer.py",
        "version.json",
        "dist/index.html",
        "LICENSE",
    ):
        if not (root / required).is_file():
            raise ValueError(f"Release is missing {required}.")
    return root


def install(archive: Path, install_dir: Path, bin_dir: Path, release_base: str) -> None:
    if os.name != "posix":
        raise ValueError(
            "The shell installer supports macOS and Linux. Use the web app on Windows."
        )
    install_dir = install_dir.expanduser().absolute()
    bin_dir = bin_dir.expanduser().absolute()
    if install_dir == Path.home() or install_dir == Path("/"):
        raise ValueError("Choose a dedicated installation directory.")
    current = install_dir / "current"
    if current.exists() and not current.is_symlink():
        raise ValueError(f"Refusing to replace an existing directory: {current}")
    launcher = bin_dir / "draft.md"
    for name in ("draft.md", "dmd", "draftmd"):
        candidate = bin_dir / name
        if candidate.exists() or candidate.is_symlink():
            expected = (install_dir / "launcher.sh") if name == "draft.md" else launcher
            if not candidate.is_symlink() or candidate.readlink() != expected:
                raise ValueError(f"Refusing to replace unrelated command: {candidate}")
    install_dir.mkdir(parents=True, exist_ok=True)
    bin_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="staging-", dir=install_dir) as staging:
        root = extract_archive(archive, Path(staging))
        metadata = json.loads((root / "version.json").read_text())
        version = metadata["version"]
        if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", version):
            raise ValueError("Invalid release version.")
        metadata.update(
            release_base=release_base,
            install_dir=str(install_dir),
            bin_dir=str(bin_dir),
        )
        (root / "version.json").write_text(json.dumps(metadata, indent=2) + "\n")
        versions = install_dir / "versions"
        versions.mkdir(exist_ok=True)
        # Unique version directories let a running server retain its own assets during updates.
        release = (
            versions
            / f"{version}-{hashlib.sha256(archive.read_bytes()).hexdigest()[:12]}"
        )
        if not release.exists():
            root.rename(release)
        else:
            metadata_path = release / "version.next.json"
            metadata_path.write_text(json.dumps(metadata, indent=2) + "\n")
            metadata_path.replace(release / "version.json")
        replacement = install_dir / "current.next"
        replacement.unlink(missing_ok=True)
        replacement.symlink_to(release)
        replacement.replace(current)
    wrapper = (
        "#!/usr/bin/env bash\nset -euo pipefail\n"
        f'exec "${{DRAFT_PYTHON:-python3}}" {shlex.quote(str(current / "cli.py"))} "$@"\n'
    )
    wrapper_path = install_dir / "launcher.sh"
    wrapper_path.write_text(wrapper)
    wrapper_path.chmod(0o755)
    for name in ("draft.md", "dmd", "draftmd"):
        target = bin_dir / name
        target.unlink(missing_ok=True)
        target.symlink_to(wrapper_path if name == "draft.md" else launcher)
    print(f"Installed Draft.md {version} in {install_dir}")
    print(f"Launch: {launcher}")
    if str(bin_dir) not in os.environ.get("PATH", "").split(os.pathsep):
        print(
            f'Add this to your shell profile: export PATH={shlex.quote(str(bin_dir))}:"$PATH"'
        )
    print(
        f"Optional start/run helpers: source {shlex.quote(str(current / 'shell-helpers.sh'))}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Install the prebuilt Draft.md app without npm."
    )
    parser.add_argument(
        "--archive",
        type=Path,
        help="Install a local release archive, without downloading.",
    )
    parser.add_argument("--base-url", default=RELEASE_BASE)
    parser.add_argument(
        "--install-dir", type=Path, default=Path.home() / ".local/share/draft-md"
    )
    parser.add_argument("--bin-dir", type=Path, default=Path.home() / ".local/bin")
    args = parser.parse_args()
    if sys.version_info < (3, 10):
        parser.error("Python 3.10+ is required.")
    try:
        if args.archive:
            install(args.archive, args.install_dir, args.bin_dir, args.base_url)
        else:
            if not args.base_url.startswith("https://"):
                raise ValueError("Release downloads require HTTPS.")
            with tempfile.TemporaryDirectory(prefix="draft-md-download-") as temporary:
                folder = Path(temporary)
                manifest = folder / "release.json"
                download(args.base_url + "/release.json", manifest, 1024 * 1024)
                info = json.loads(manifest.read_text())
                filename = info["archive"]
                if not re.fullmatch(r"draft-md-[0-9A-Za-z.+-]+\.tar\.gz", filename):
                    raise ValueError("Invalid release archive filename.")
                archive = folder / filename
                download(args.base_url + "/" + filename, archive)
                digest = hashlib.sha256(archive.read_bytes()).hexdigest()
                if digest != info["sha256"]:
                    raise ValueError("Release checksum mismatch. Installation stopped.")
                install(archive, args.install_dir, args.bin_dir, args.base_url)
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        parser.exit(1, f"Installation failed: {error}\n")


if __name__ == "__main__":
    main()
