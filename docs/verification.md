# Verification record

Implementation verified on October 7, 2026, on Apple M4 / 24 GB RAM / macOS Darwin 25.4.0. Node 26.8.2, strict TypeScript, production Vite build. Browser integration used installed Google Chrome 154.0.8037.99 through Playwright.

## Automated checks

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 30 tests passed across six files.
- `npm run build`: passed; `dist/` is a static SPA with manifest, icons, service worker, and bundled/lazy assets. Vite reports large lazy editor/Mermaid chunks; size is documented rather than suppressed.
- `DRAFT_BROWSER_CHANNEL=chrome npm run test:e2e`: nine production browser workflows passed.
- `npm audit`: zero vulnerabilities reported at verification time.

Core tests exercise exact Markdown, nested/binary filesystem operations, collisions, partial moves, a source changing during copying, invalid paths, archive round trips/traversal rejection, permissions, IndexedDB reopening/recovery, delayed and immediate saves, edits during writes, dirty tab closure, failed writes/checkpoints, deleted originals, stale/concurrent reads, conflicts and explicit resolution, search updates/line targets, knowledge parsing, tables, math/Markdown sanitization and blocked remote images.

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
