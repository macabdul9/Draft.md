# Performance reference run

Measured on October 7, 2026: Apple M4, 10 logical cores, 24 GB RAM, macOS Darwin 25.4.0, Google Chrome 154.0.8037.99, headless Playwright. Production Vite assets served from localhost. The machine was running other processes; results are a reference run, not a calibrated hardware guarantee.

| Measurement                                         | Recorded result | Acceptance interpretation                                    |
| --------------------------------------------------- | --------------: | ------------------------------------------------------------ |
| Initial application JS, gzip                        |         32.3 KB | Below the 100 KB shell target                                |
| Separately loaded editor JS, gzip                   |        238.9 KB | Explicit first-editor cost; excluded from shell, not hidden  |
| All JS including every lazy capability, gzip        |       1701.6 KB | Includes math, Mermaid layouts and language parsers          |
| Cold shell, navigation to workspace control         |         74.3 ms | App usable before editor code                                |
| First editor after Create workspace                 |        230.7 ms | Includes storage creation and lazy editor loading            |
| Rich typing, ordinary 2,213-character note, p95     |          0.9 ms | Synchronous editor transaction work below 16 ms              |
| Rich typing, 243,430-character document, p95        |          6.7 ms | Synchronous editor transaction work below 16 ms              |
| 5,000-file workspace tree usable                    |        129.1 ms | Only 70 rows mounted in the flat-list window                 |
| First editor in newly reopened 5,000-file workspace |        149.5 ms | Editor loaded while background indexing continued            |
| Full 5,000-file index                               |       1633.0 ms | Index finishes after the tree/editor become usable           |
| Warm small-note activation, eight tabs, p95         |         96.8 ms | Under 100 ms in this workload, including automation overhead |
| Search, including 100 ms input debounce             |        194.9 ms | Worker query across 5,000 locally indexed files              |

The tree/editor became usable with status **Indexing locally · 400 files**. This confirms workspace opening does not wait for the complete index. Indexing is local, incremental and cancellable. There is no idle full-workspace polling loop; open-document checks happen on focus/visibility return and before writes.

## Method and limits

The ordinary note contains headings, prose, bold, lists, a table and a Python code fence. The large document repeats that note 110 times. Rich Markdown is enabled for both typing measurements. Each sample uses 86 actual keyboard text changes with 20 ms between keys. Timers surround CodeMirror's text-changing dispatchTransactions calls. This covers synchronous document update, rich decorations, save-controller scheduling and editor work. It **does not** measure all browser layout/paint, garbage collection between events, debounced outline/search processing, or first-load asynchronous math/diagram rendering. The complete main-thread-work-per-keystroke target therefore remains a broader profiling requirement; these results are bounded evidence, not a full browser trace or a cross-device guarantee.

Activation measurements include Playwright click scheduling and a locator visibility check. They are conservative UI timings, not a pure in-app activation clock. The first activation after reopening includes editor initialization; warm indexed activations are recorded separately. The 5,000 generated browser files contain about 11 MB of Markdown with one 243 KB note. They are created in disposable OPFS inside the test browser profile; no operating-system research directory is touched. File-system latency on network drives or real user disks was not measured.

The service worker precaches the complete app capability set (approximately 6.4 MB of uncompressed assets, including fonts). This makes first-use lazy capabilities available offline but adds background download cost after the small shell loads. JavaScript bundle totals count every emitted language/layout chunk, not just features used in this particular run. Runtime assets are hosted locally with the app; no renderer CDN receives content.

## Reproduce

Start the production preview server on port 4174, then run:

```sh
npm run build
npm run preview -- --port 4174
# In another terminal:
DRAFT_BROWSER_CHANNEL=chrome npm run benchmark
```

Use DRAFT_URL to change the origin and DRAFT_BROWSER_CHANNEL to choose an installed supported Chrome channel. The script writes docs/performance.json and a screenshot. It uses an isolated browser profile that is closed afterward. Raw measurements, workload sizes, manifest filenames and byte totals are in performance.json. Source changes require rebuilding before measuring. This run measured the final production code; editing a screenshot or documentation does not change its runtime evidence.
