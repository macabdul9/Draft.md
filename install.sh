#!/usr/bin/env bash
set -euo pipefail

release_base="${DRAFT_RELEASE_BASE:-https://github.com/macabdul9/Draft.md/releases/latest/download}"
installer_url="${release_base}/installer.py"
task_install_dir="$(mktemp -d)"
trap 'rm -rf "$task_install_dir"' EXIT

command -v python3 >/dev/null || { echo 'Python 3.10+ is required. Install Python, then retry.' >&2; exit 1; }
curl --fail --silent --show-error --location "$installer_url" --output "$task_install_dir/installer.py"
python3 "$task_install_dir/installer.py" --base-url "$release_base" "$@"
