# AI Agent writing harness

The harness is deliberately small: resolve the saved model, make one bounded writing request, and stream the response into one undoable edit. It has no tool framework, shell access, recursive agent loop, or additional dependencies.

## Everyday interaction

- Type an instruction in the document and press **⌘/Ctrl+Enter** to write with the remembered model. On a blank line it continues the note; with selected text it improves that selection.
- `@agent <instruction>` plus **⌘/Ctrl+Enter** writes immediately. Engine-specific mentions override the engine for that request.
- There is no persistent agent panel or toolbar button. Change the model through **Settings → AI Agent**. Browsing/checking a path saves it once. Starting the server manually is optional.
- `@ollama` downloads the chosen supported small model on first use, with a footer spinner and progress. The default is LiquidAI/LFM2.5-2.6B. Automatically saved choices from older builds are ignored unless explicitly reselected. Subsequent uses reuse the installed model.
- Output goes straight into the note. A single Undo restores the previous text. Concurrent user edits cause the output to appear as a recovered draft instead.

## Responsibilities

| File                            | Responsibility                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/preferences.ts`     | Remember engine, model, weight path, and launch options in IndexedDB; exclude credentials.                                          |
| `src/agents/writing.ts`         | Reuse a running connection, reconnect or start the saved runtime, wait for readiness, resolve the saved model, and request writing. |
| `packaging/writing_harness.py`  | Bound reference text, assemble writing rules and messages, and normalize the returned Markdown.                                     |
| `packaging/local_models.py`     | Verify model size and make the engine-specific inference request.                                                                   |
| `src/components/EditorPane.tsx` | Capture the intended edit, detect concurrent changes, and apply incremental chunks as one isolated undo group.                                     |

## Writing rules

The system instruction asks the model to return only the requested Markdown, match the note's language and tone, preserve meaning when revising, and avoid repeating text when continuing. It asks the model to mark missing facts as `[TODO]` rather than invent quotations, citations, or results. Reference note text is labeled as data; the writing request is the final user message. These are model instructions, not a guarantee of factual accuracy.

The harness sends only a bounded excerpt around the cursor and the selection: at most 6,000 reference characters, 2,000 selected characters, and a 2,000-character instruction. It does not retrieve other notes, execute commands, or let a model choose file operations. The chosen endpoint receives the context. Other workspace files remain outside the request.

## Model resolution and limits

1. Use the remembered engine, unless the mention names a specific engine.
2. Reuse its live connection. If necessary, reconnect using saved non-secret settings or start the saved local runtime and weight path. For local Ollama, try the existing service before launching a daemon.
3. Use the saved model. With no saved choice, prefer installed LiquidAI/LFM2.5-2.6B, then a verified available small model. A missing explicitly saved model produces an actionable error rather than silently changing it.
4. Verify the model before inference. The 4B cap uses checked local weight metadata or Ollama's exact parameter count. External compatible endpoints without verifiable size remain unsupported for writing.
5. Request up to 512 output tokens. Default context is 4,096 tokens, responses are capped at 1 MiB, and generation times out after 120 seconds. Runtime startup has a separate five-minute bound. Character bounds are conservative excerpts, not exact token counts.

Only non-secret configuration persists, scoped to the browser origin. Clearing browser data removes it; changing ports uses another origin. API keys remain in the current bridge session. Authenticated endpoints may require re-entering their key after restarting the bridge.

## Cancellation and editing

Generation uses native Ollama NDJSON or compatible chat-completion SSE, forwarded immediately through the authenticated bridge as NDJSON. The browser decodes fragmented UTF-8 and inserts each arriving chunk directly into the note. Completion normalizes Markdown wrappers. The entire streamed passage shares one undo group, including slow responses.

Escape or the footer Stop control aborts the browser request and retains writing already received. Closing the downstream stream closes the upstream response when the bridge next receives a chunk; immediate engine-side cancellation depends on the inference runtime. Cold model loading still delays the first token.

Each update checks the expected document contents. If you edit during generation, automatic insertion stops and the completed draft is available under **Review draft**. Interrupted or malformed streams report an error and keep already inserted text.

## First-word latency

Ollama writing requests keep the selected model resident for ten minutes of inactivity rather than unloading it after each completion. Writing disables thinking output. For LiquidAI/LFM2.5-2.6B, a trailing assistant prefill closes the thinking block before generation; merely setting `think: false` on the tested Ollama renderer exposes reasoning as content instead of skipping it. Other model families retain their normal message format. No reasoning trace is inserted into the note intentionally.

The browser resolves the remembered model without repeating selection and discovery requests on every invocation. The bridge still verifies the model parameter count before generation. A first download or cold model load takes longer than a warm request; token streaming begins as soon as actual writing arrives.

## Draft.md knowledge and creation requests

The harness includes a compact capability guide grounded in the editor's actual writing commands: interactive checkbox tasks and the To-do List template, headings and formatting, lists and quotes, tables, fenced code, math, fenced LaTeX tables, Mermaid, callouts, images, links, and wiki links. It also describes the backslash and @ menus, table editing, document modes, task completion, Undo, autosave, and workspace controls. These are product capabilities, not agent-executable tool APIs: the current agent creates Markdown at the intended range and cannot inspect unseen notes or operate file/UI controls.

Creation is separate from retrieval. A request to write todos creates checkbox tasks even when the current note contains no tasks. Supplied tasks take precedence; an unspecified creation request produces a suggested starter checklist. Unrelated context must not block creation or trigger questions about missing task-management data. Task requests receive a short format instruction before the original request to keep the output focused on editable checkboxes. Requests to extract existing tasks use reference data instead of inventing a schedule.

Verified with the installed Liquid model using unrelated book notes: “write todos here” produced a heading and three unchecked starter tasks, and a report checklist request included outline, drafting, and proofreading tasks.

## Additional providers

The same bounded writing messages are now used by local Codex and Claude Code adapters and by ChatGPT/Claude website requests. The CLI adapters own and cancel their subprocesses; the website bridge uses an explicitly paired Chrome extension and dedicated provider tabs. Provider routing never silently substitutes an inference engine. See [setup, permissions, and tested limits](agent-providers.md).
