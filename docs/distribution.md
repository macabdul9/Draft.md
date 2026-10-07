# Distribution

Draft.md can run as a static browser app or as a locally installed, prebuilt app served by a small Python launcher. The local installer requires Python 3.10+, Bash, and curl on macOS or Linux. The editor still runs in the browser; this package is not a native desktop executable or a bundled Python runtime.

## Build and test a local package

```sh
npm ci
npm run lint
npm test
npm run build
npm run package:release
npm run test:cli
```

The package script produces these files in the ignored `release/` directory:

- `draft-md-VERSION.tar.gz`: compiled application, Python CLI/installer, optional shell helpers, version metadata, and MIT license. Third-party notices are included in the static application.
- `release.json`: version, archive filename, and SHA-256 checksum.
- `SHA256SUMS`: checksum for independent verification.
- `install.sh`: curl-compatible bootstrap script.
- `installer.py`: standard-library installer downloaded by the bootstrap.

Install locally using `python3 packaging/installer.py --archive release/draft-md-0.0.1.tar.gz`. Custom `--install-dir` and `--bin-dir` arguments allow isolated testing without modifying normal shell commands. No shell profiles are edited.

The installer stages and validates archives before updating the `current` symlink. It rejects traversal, duplicate members, symlinks, hard links, and device entries. It refuses unrelated launcher collisions, retains older versions, and switches the current app with an atomic symlink replacement. It does not encrypt browser storage or perform cross-process filesystem locking for note writes.

The server serves only its installed `dist/` directory, never the installation's Python files or a selected workspace. A file lock prevents multiple managed server processes; shutdown uses a random token stored in a mode-600 state file. Local notes and browser data are outside app installation files and are retained by uninstall. Save before stopping, restarting, updating, or uninstalling. A loaded browser tab can retain in-memory edits, but stopping its app server is not a substitute for saving or backing up.

## Publish a release

The repository is `macabdul9/Draft.md`. The release workflow packages on a manual dispatch and uploads a reviewable workflow artifact. A pushed version tag or a published release additionally publishes installer assets. Publishing a tag is a remote action; the local scripts do not push or create a release themselves.

For an existing release with no assets, push the updated workflow, then open **Actions → Package local installer → Run workflow**, choose the branch to build (normally `main`), and enter `v0.0.1` in **release_tag**. This builds the selected branch and attaches the installer assets to the existing release. This also lets a corrected branch repair a failed release without moving its tag. Leave the input empty to build an artifact without publishing. Non-version release names such as `beta` retain the app version from `package.json`; `v` tags must match the package version.

Alternatively, upload all five files from the local `release/` folder to the existing release through **Releases → Edit → Attach binaries**, then save it. Required assets are `install.sh`, `installer.py`, `release.json`, `SHA256SUMS`, and `draft-md-VERSION.tar.gz`. GitHub's automatic source archives do not contain a ready-to-install build.

1. Review and commit the changes. Update the package version and lockfile when changing versions.
2. Run the app checks, browser workflows, Python checks, ShellCheck, and CLI tests.
3. Push the reviewed branch and a matching tag, such as `v0.0.1` for package version `0.0.1`.
4. Allow `.github/workflows/release.yml` to finish and verify the five release assets.
5. Test the public install command in a fresh profile or with custom installation directories.

```sh
curl -fsSL https://github.com/macabdul9/Draft.md/releases/latest/download/install.sh | bash
```

The curl URL returns no usable installer until a release containing those assets is published. Repository source commits and local package generation do not make the release URL live. The latest URL selects the latest stable GitHub release; use a versioned release asset base through `DRAFT_RELEASE_BASE` to pin the installer and app to a tag.

Downloaded artifacts are checksum-verified against the release manifest. That catches corruption/mismatches, but the manifest and code share the same distribution trust boundary. Signed releases or platform-specific notarization would require additional work.

## Download statistics

`scripts/download-stats.py` reads all pages of the GitHub releases API and sums `download_count` only for `draft-md-VERSION.tar.gz` app assets and future `draft-md-extension-VERSION.zip` extension assets. Curl installation, direct browser downloads, and CLI update downloads all reach those assets. The script omits installer helpers, manifests, and checksums so it does not count several helper requests as several app downloads. GitHub documents the release asset [download count](https://docs.github.com/en/rest/releases/assets).

The result is a **download event count**, not successful installations, unique people, or active users. Updates and repeated downloads count again. GitHub source ZIPs, clones, redistributed copies, mirrors, offline installation, and Chrome Web Store distribution are not automatically included. The app and installer send no separate analytics events.

`.github/workflows/download-stats.yml` runs daily, on manual dispatch, and on eligible release events, then commits `stats/downloads.json` on `main`. GitHub does not trigger most new workflow runs from actions performed with `GITHUB_TOKEN`, so a release created by the release workflow may wait for the scheduled statistics refresh. A manual statistics dispatch refreshes sooner. The workflow needs permission to commit to `main`; branch protection or disabled Actions may require a maintainer-driven update instead. The README uses a Shields endpoint badge, so its displayed value may also be cached.

To add an independent source, put a verified record in `stats/external-downloads.json`:

```json
{
  "sources": [
    {
      "channel": "independent-distribution",
      "metric": "cumulative-downloads",
      "count": 123,
      "source_url": "https://example.com/verified-download-report",
      "observed_at": "2026-10-07",
      "non_overlapping": true
    }
  ]
}
```

This is an illustrative record, not an actual source or count. Each source must use a unique channel, supply cumulative downloads with provenance, and avoid counting downloads already included elsewhere. Do not list curl, bash, and the GitHub archive as separate sources: they are the same artifact download. The script rejects active-user metrics and overlapping source declarations. Maintainers must verify that a provider's numbers actually have the stated meaning; the script cannot audit external reports.

Chrome Web Store offers developer-dashboard [installation and user metrics](https://developer.chrome.com/docs/webstore/metrics), but no published extension or authenticated reporting connection exists for this project. A displayed store user count is not automatically a cumulative installation or download count. When an extension ships, its verified installation metrics can be shown separately, or a compatible cumulative download series can be added with explicit provenance. A universal, automatically exact all-source installation counter needs a shared reporting service or integrations with every distribution provider; that is not implemented by this browser-only app.

## Extension assessment

A Manifest V3 extension that opens the app in a full extension tab is feasible. Its bundle can contain the application, fonts, search worker, Markdown renderer, math, diagrams, ZIP support, and IndexedDB/OPFS workspaces. It would not need a local server or native helper for those browser capabilities.

Shipping it requires a separate build configuration, extension manifest and entry point, extension-relative URLs, compatible worker/chunk loading and content security policy, removal of PWA registration, and host permissions for explicit GitHub imports. Chrome's [remote code policy](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code) requires bundled executable code, and its [extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) constrains execution. Local directory pickers, handle persistence/permissions, clipboard interactions, PDF/object URLs, and offline behavior require actual extension-context tests.

This is a feasibility assessment. No extension package, Web Store submission, or approval is claimed. A full Git clone using a native Git executable would require a separate native helper; the current repository importer only downloads public file snapshots.
