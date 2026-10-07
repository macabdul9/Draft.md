# Draftly decision

Evaluated the published `draftly@2.1.0` package, its source, [repository](https://github.com/nexuls/draftly), and [playground](https://draftly.nexul.in/playground). The playground returned a loading screen in this environment; source/API evaluation and our own browser tests supplied the functional evidence. No research documents were entered into external services.

The repository declares MIT, preserved in `public/THIRD_PARTY_NOTICES.txt`. The registry release history inspected during implementation lists 2.1.0 on 2026-03-29. The repository has a plugin-based CodeMirror/Lezer architecture and ongoing source activity; that is evidence of maintenance, not a support guarantee. The current source package metadata and published package differ, so this app pins the inspected release.

The core `draftly(config)` function returns CodeMirror extensions. It accepts explicit plugins, Markdown parser extensions, line wrapping, raw/source mode, keymaps/history configuration, and an `onNodesChange` AST callback. Plugins provide decoration, parser, extension, and keymap hooks. Draft.md reads CodeMirror’s Lezer syntax tree on a debounce instead of enabling the callback that builds a full tree representation on every selection/document update.

The public `draftly/plugins` entry initializes broad plugin collections and reaches math, Mermaid, and emoji code. The installed package exposes `./src/*`, so Draft.md imports the core plus selected heading, inline, list, quote, code, table, and horizontal-rule plugins through pinned source subpaths. Source and compiled plugin base classes must not be mixed: their private TypeScript members have separate identities. This implementation uses the source base consistently. This depends on the pinned package’s exported layout and must be rechecked before upgrading.

Draftly needs no React/Preact adapter. It works directly inside our CodeMirror EditorView. Its tested contributions are reused rather than rebuilt.

Draftly’s image widget assigns a Markdown URL directly to `img.src`; its HTML plugin uses DOMPurify but permits ordinary remote-resource markup. Neither implements a workspace adapter, document-relative object-URL resolution, or our no-automatic-remote-fetch policy. We therefore omit those plugins. The app’s research plugin resolves local assets through the adapter, sanitizes rendering, and manages object URL lifetimes. Raw HTML is editable in rich/source mode and sanitized in preview/export.

The published math plugin imports KaTeX and raw CSS eagerly; its default Mermaid plugin imports the diagram library directly. We omit those too and use on-demand modules with explicit trusted-math/strict-diagram settings, preprocessing that rejects resource URLs, and final sanitization. Registry dependency overrides select a patched KaTeX version; `npm audit` reported zero findings on the final install.

Adoption was conditional on measured behavior. Production browser tests cover preserved text across modes, dirty tabs, state restoration after asset viewing, exact persistence, and asynchronous rendering. The shell stays below 100 KB gzipped; the editor is separately loaded and costs roughly 239 KB gzipped. Rich synchronous editing on both a 2.2 KB note and a 243 KB document stayed below 16 ms p95 in the documented reference workload. See `performance.json` for final measurements and `performance.md` for measurement limitations. Source-based selective imports avoid loading math/Mermaid at editor startup, but all supported offline assets are eventually precached by the service worker.

Standard Markdown remains the document model; Draftly is a formatting layer. No content migration, proprietary document representation, or server rendering is introduced.
