from __future__ import annotations

from datetime import datetime, timezone
from html import escape
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


def download_badge(message: str, published: bool) -> str:
    label_width = 120
    value_width = max(30, len(message) * 7 + 12)
    width = label_width + value_width
    label = escape(f"recorded downloads: {message}", quote=True)
    color = "#007ec6" if published else "#9f9f9f"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="20" '
        f'viewBox="0 0 {width} 20" role="img" aria-label="{label}">'
        f"<title>{label}</title>"
        f'<rect width="{width}" height="20" rx="3" fill="{color}"/>'
        f'<path d="M3 0h{label_width - 3}v20H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3z" fill="#555"/>'
        '<g fill="#fff" text-anchor="middle" font-family="Verdana,Arial,sans-serif" font-size="11">'
        f'<text x="{label_width / 2}" y="14">recorded downloads</text>'
        f'<text x="{label_width + value_width / 2}" y="14">{escape(message)}</text>'
        "</g></svg>\n"
    )


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
    (ROOT / "stats/downloads.svg").write_text(
        download_badge(report["message"], published or bool(external))
    )
    print(f"Recorded downloads: {report['message']}")


if __name__ == "__main__":
    main()
