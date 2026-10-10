from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    version = json.loads((ROOT / "package.json").read_text())["version"]
    tag = os.environ.get("DRAFT_RELEASE_TAG")
    if tag and tag != f"v{version}":
        raise SystemExit(f"Release tag {tag} must match package version v{version}.")
    if not (ROOT / "dist/index.html").exists():
        raise SystemExit("Run npm run build before packaging a release.")
    output = ROOT / "release"
    output.mkdir(exist_ok=True)
    extension = output / "website-extension.zip"
    with zipfile.ZipFile(extension, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for source in sorted((ROOT / "extension/website").glob("*")):
            if source.is_file():
                archive.write(source, source.name)
    filename = f"draft-md-{version}.tar.gz"
    with tempfile.TemporaryDirectory(prefix="draft-md-package-") as temporary:
        payload = Path(temporary) / "draft-md"
        payload.mkdir()
        shutil.copytree(ROOT / "dist", payload / "dist")
        shutil.copy2(extension, payload / "dist/website-extension.zip")
        shutil.copytree(ROOT / "extension/website", payload / "website-extension")
        for name in (
            "cli.py",
            "local_models.py",
            "model_files.py",
            "writing_harness.py",
            "agent_processes.py",
            "model_catalog.json",
            "installer.py",
            "shell-helpers.sh",
        ):
            shutil.copy2(ROOT / "packaging" / name, payload / name)
        shutil.copy2(ROOT / "LICENSE", payload / "LICENSE")
        (payload / "version.json").write_text(
            json.dumps({"version": version}, indent=2) + "\n"
        )
        with tarfile.open(output / filename, "w:gz") as archive:
            archive.add(payload, arcname="draft-md")
    checksum = hashlib.sha256((output / filename).read_bytes()).hexdigest()
    (output / "release.json").write_text(
        json.dumps(
            {"version": version, "archive": filename, "sha256": checksum}, indent=2
        )
        + "\n"
    )
    (output / "SHA256SUMS").write_text(f"{checksum}  {filename}\n")
    shutil.copy2(ROOT / "install.sh", output / "install.sh")
    shutil.copy2(ROOT / "packaging/installer.py", output / "installer.py")
    print(f"Packaged {output / filename}")


if __name__ == "__main__":
    main()
