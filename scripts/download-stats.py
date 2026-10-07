from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = "macabdul9/Draft.md"


def release_downloads() -> tuple[int, bool]:
    total = 0
    found_asset = False
    page = 1
    while True:
        request = Request(
            f"https://api.github.com/repos/{REPOSITORY}/releases?per_page=100&page={page}"
        )
        request.add_header("Accept", "application/vnd.github+json")
        token = os.environ.get("GH_TOKEN")
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        with urlopen(request, timeout=30) as response:
            releases = json.load(response)
        for release in releases:
            if release.get("draft"):
                continue
            for asset in release["assets"]:
                # Count application artifacts once; installer scripts/manifests/checksums are helpers.
                if re.fullmatch(
                    r"draft-md-[A-Za-z0-9.+-]+\.tar\.gz|draft-md-extension-[A-Za-z0-9.+-]+\.zip",
                    asset["name"],
                ):
                    total += asset["download_count"]
                    found_asset = True
        if len(releases) < 100:
            return total, found_asset
        page += 1


def aggregate_sources(downloads: int, sources: list[dict]) -> tuple[int, list[dict]]:
    names = {"github-release-assets"}
    for source in sources:
        name = source["channel"]
        if name in names:
            raise ValueError(f"Duplicate statistics channel: {name}")
        names.add(name)
        if (
            source["metric"] != "cumulative-downloads"
            or type(source["count"]) is not int
            or source["count"] < 0
        ):
            raise ValueError(
                "Only nonnegative cumulative downloads may be added; active users are a different metric."
            )
        if not source["source_url"].startswith("https://") or not source["observed_at"]:
            raise ValueError(
                "External download counts need a source URL and observation date."
            )
        if not source.get("non_overlapping"):
            raise ValueError(
                "External sources must not overlap with release asset downloads."
            )
        downloads += source["count"]
    return downloads, sources


def main() -> None:
    downloads, published = release_downloads()
    sources = json.loads((ROOT / "stats/external-downloads.json").read_text())[
        "sources"
    ]
    total, external = aggregate_sources(downloads, sources)
    report = {
        "schemaVersion": 1,
        "label": "recorded downloads",
        "message": str(total) if published or external else "not released",
        "color": "blue" if published or external else "lightgrey",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total": total,
        "github_release_downloads": downloads,
        "external_sources": external,
        "coverage": "GitHub app release assets (curl installer, CLI updates, and direct downloads) plus explicitly recorded non-overlapping sources. Not successful installs or unique users.",
    }
    (ROOT / "stats/downloads.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Recorded downloads: {report['message']}")


if __name__ == "__main__":
    main()
