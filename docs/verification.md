# Verification record

Implementation verified on October 7, 2026, on Apple M4 / 24 GB RAM / macOS Darwin 25.4.0. Node 26.8.2, strict TypeScript, production Vite build. Browser integration used installed Google Chrome 154.0.8037.99 through Playwright.

## Automated checks

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 47 tests passed across ten files.
- `npm run build`: passed; `dist/` is a static SPA with manifest, icons, service worker, and bundled/lazy assets. Vite reports large lazy editor/Mermaid chunks; size is documented rather than suppressed.
- `DRAFT_BROWSER_CHANNEL=chrome npm run test:e2e`: all 17 production browser workflows passed in the final full run.
- `npm audit`: zero vulnerabilities reported at verification time.

## Local installation and distribution checks

Fenced LaTeX tables were verified in Preview and Rich Markdown, including booktabs rules, captions, alignment, cell math, and saving/reopening unchanged source. Unit coverage includes the supplied 3×3 empty table, the menu starter, merged cells, escaped separators, nested formatting, malformed input, unsupported commands, size bounds, HTML escaping, and language-fence isolation. The light-theme table screenshot was visually inspected.

Backslash block/task commands, table-row insertion, keyboard acceptance with Enter/Tab, date insertion, relative file links, and the empty-file guide disappearing and returning were verified in Chrome. The default remains light even with dark OS preferences; an explicitly saved dark choice survives reload. Unit tests cover Unicode queries and suppress triggers inside email addresses, paths, code, links, and inline math.

The To-do List workspace and file templates were verified with quick task entry, Rich Markdown checkbox toggling, completed-task counts, exact saved `- [x]` Markdown, cancellation without file creation, and reopening. Task-count tests also verify nested tasks and exclusion of code examples. New notes now choose a template before file creation. Preview remains a read-only rendering of task status; tasks are toggled in Rich Markdown.

The general-purpose UI and new light-theme README screenshot were verified with the latest production build. The app's tagline is “Your work, in Markdown.” Generic Project Notes and Meeting Notes templates supplement the optional academic templates.

- Python 3.14.7 on macOS: eight CLI/installer/statistics tests passed. Tests cover real curl-to-Bash installation over a local HTTPS fixture, checksum rejection, archive traversal/link/device rejection, unrelated launcher collision refusal, reinstall, aliases and optional shell helpers, server reuse, status, shutdown, host/path/shutdown-token boundaries, uninstall preserving notes, pagination, and avoiding mixed/overlapping download metrics.
- Ruff formatting and lint checks passed for the Python files. ShellCheck passed for `install.sh` and the sourced shell helpers.
- `npm run package:release` produced a prebuilt application archive and release manifest/checksum/bootstrap assets.
- The actual archive was installed in `~/.local/share/draft-md`, with `draft.md`, `draftmd`, and `dmd` launchers in `~/.local/bin`. Its server launched on `http://127.0.0.1:4387`.
- A separate Chrome workflow against that installed server verified workspace creation, editing, live split preview, saving, actual network-disabled reload, and reopening the stored workspace.
- The documentation screenshot script captured and the editor image was visually inspected in light theme, using generic project notes.
- The download statistics script queried the public repository and accurately reported “not released”; no release artifact downloads or extension installs were fabricated.

The [automatic release workflow](https://github.com/macabdul9/Draft.md/actions/runs/37684583258) passed on GitHub's Ubuntu runner with Node 22, Python 3.10, ShellCheck, lint, 47 unit tests, the strict production build, all 17 Playwright browser workflows, and eight installer/statistics tests. It published all five assets on `v0.0.1`. Downloading the public latest-release bootstrap and installing into an isolated macOS directory succeeded; its launcher reported `Draft.md 0.0.1`. The public curl endpoint is now live. No interactive native disk-folder test is implied by this installer check.

CI exposed a tab-switch search indexing race and a preferences startup/write race; both were corrected before publication. Workflow validation used actionlint and Bash syntax checks. Local mocked publishing checks verified new release creation at the checked commit, incomplete-release repair, preserving complete releases on unchanged versions, and explicit manual asset replacement. GitHub's scheduled statistics workflow has also run successfully; its badge can lag new downloads until refresh. Chrome extension feasibility is documented; no extension was built or submitted.

Core tests exercise exact Markdown, nested/binary filesystem operations, collisions, partial moves, a source changing during copying, invalid paths, archive round trips/traversal rejection, permissions, IndexedDB reopening/recovery, delayed and immediate saves, edits during writes, dirty tab closure, failed writes/checkpoints, deleted originals, stale/concurrent reads, conflicts and explicit resolution, search updates/line targets, knowledge parsing, tables, math/Markdown sanitization and blocked remote images. Repository tests cover URL validation, commit-pinned downloads, binary preservation, skipped symbolic links/submodules, branch names with slashes, truncated/unsafe/oversized listings, rate limits, cancellation, unexpected byte sizes, and collision preservation.

Additional browser checks cover the default Rich Markdown/Preview split, live preview updates, narrow-screen stacking, repository imports with offline reopening, repository error handling with an active workspace, cancellation before workspace creation, and a local import that preserves an existing same-name folder. Repository fixtures mock GitHub responses; local-folder tests use real OPFS handles returned by a stubbed picker. A separate live Chrome check successfully imported the public `octocat/Spoon-Knife` repository directly from GitHub and displayed its README, without mocked network responses.

Browser workflows exercise browser workspace creation and reopening, tabs, search, ZIP download, a native-adapter same-handle write and external conflict, math/Mermaid/callout/security rendering, fallback messaging and theme/focus restoration, offline reopening and previously unused lazy renderers, nested screenshot paste and relative references, local image view, duplicate/move/delete, local PDF embedding, invalid-diagram errors, cursor/undo restoration across tabs, and folder-import collision handling with intact relative links. Offline testing actually disables networking, reloads the application, reopens a stored workspace, and renders both math and Mermaid.

The native test picker is stubbed to return a real OPFS directory handle. The NativeFileSystemAdapter writes and re-reads that exact handle; an independent fixture modifies it to test conflict detection. This verifies browser-bound adapter behavior. **It is not an interactive native-folder-picker or operating-system disk verification.** Permission state tests use explicit mocked handles; the app also presents a real Grant Access flow.

A newer Playwright Chromium 153 build crashed when reading a persisted OPFS directory handle. A minimal independent reproducer confirmed the failure outside Draft.md. Chrome 154 passed that reproducer and all app tests. Playwright is pinned; installed Chrome is selectable with `DRAFT_BROWSER_CHANNEL=chrome`. This is recorded as a browser-fixture limitation, not hidden as a passed native-disk check.

## Visual and performance inspection

Screenshots captured and inspected: start screen, template picker, workspace/editor, research preview, and a 5,000-note workspace. No user-provided native macOS screenshot was available. See `performance.md`, `performance.json`, and `scripts/benchmark.mjs` for measurements and reproduction. Performance values are single-run reference measurements, not cross-device guarantees.

## Manual checks still needed on a user desktop

1. In Chrome/Edge on localhost or HTTPS, choose an existing disposable disk folder containing nested `.md`, images, PDFs and `.bib`. Confirm no files are added merely by opening it.
2. Edit an existing note, wait for Saved, and open it independently in VS Code. Compare exact text and confirm the original directory was used.
3. Edit the same note externally while Draft.md has pending text. Resolve Compare/Reload/Keep and confirm the resulting disk bytes. Test an externally deleted/renamed file, and download its retained draft.
4. Close/reopen the browser. Reopen the recent folder, revoke folder permission, and test the browser’s actual prompt/denied/Grant Access interactions.
5. Try real OS drag/drop, a screenshot from the clipboard, folder moves, collisions, and permanent-delete confirmation in the disposable folder.
6. In Safari/Firefox, create/import/export a browser workspace; verify IndexedDB fallback if OPFS is unavailable. Test private browsing quota/eviction behavior.
7. Inspect light/dark/system appearance at multiple zoom levels, screen-reader announcements, keyboard-only file-tree operation, mobile overlay sidebar, print output, and installation UI.
8. Finish initial offline cache installation, disconnect networking, and reopen a granted OS workspace. Save notes, close all app clients, and check service-worker update activation.

Do not treat these outstanding manual checks as passed. File System Access has no portable cross-process lock, so even verified browser workflows cannot promise atomicity against concurrent editors.
