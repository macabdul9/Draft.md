# Local inference servers

Draft.md can start installed Ollama, llama.cpp, vLLM, and SGLang servers, or connect to existing local/remote endpoints. Open **Settings → AI Agent** in the locally installed app.

This milestone provides server controls and model discovery. It does not yet send notes to a model or implement the writing agents described in [the implementation plan](../@agentic-writing-implementation-plan.md).

## Start locally

Choose a model candidate and an engine. The default is **LiquidAI/LFM2.5-2.6B**, with **llama.cpp** selected for loading a local GGUF file. Use **Browse…** or paste a path, then **Check model**. Start becomes available once local weight metadata verifies a parameter count at or below **4 billion**. For vLLM/SGLang, choose a complete original Safetensors model directory instead.

Checked paths are remembered per candidate and engine in local browser preferences; revisiting a path requires another check before launch. **Custom local model** supports other verified models up to 4B. Candidate selection does not download weights. **Get model files** opens the appropriate source; download the desired file explicitly, then select its local path.

### Small-model candidates

The catalog was checked on October 9, 2026. Counts below include stored parameters rather than relying on rounded names or an MoE active-parameter label. A small parameter count does not guarantee a particular RAM footprint; quantization, runtime, and context length still matter. Context defaults to **4,096 tokens**; owned Ollama launches also limit concurrency and loaded models to one.

| Candidate                                                                             | Total stored parameters | Role                       |
| ------------------------------------------------------------------------------------- | ----------------------- | -------------------------- |
| [LiquidAI/LFM2.5-2.6B](https://huggingface.co/LiquidAI/LFM2.5-2.6B)                   | 2,697,198,592           | Default                    |
| [LiquidAI/LFM2.5-1.2B-Instruct](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct) | 1,170,340,608           | Smaller instruction model  |
| [Qwen/Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B)                             | 2,274,069,824           | Small Qwen candidate       |
| [Qwen/Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B)                         | 873,438,784             | Lowest-parameter candidate |
| [openbmb/MiniCPM5-2B](https://huggingface.co/openbmb/MiniCPM5-2B)                     | 2,516,756,480           | Recent compact text model  |

These counts come from the publishers' Hugging Face Safetensors metadata and model cards. GGUF conversions can have slightly different stored tensor counts; Draft.md checks the actual chosen file. Liquid AI publishes its own GGUF conversions; Qwen conversion links point to Unsloth. The catalog is a shortlist, not a claim of exhaustive coverage or verified compatibility with every engine/version.

The local check sums tensor dimensions in GGUF v2/v3 or Safetensors headers without loading weights into memory. It rejects models above 4B, incomplete shard sets, split GGUF, unreadable metadata, and packed integer quantizations whose original parameter count cannot be established reliably. A renamed large file cannot pass based on its filename. Use single-file GGUF for quantized local inference. This is a metadata check, not a full model-integrity validator.

Ollama starts its daemon and offers a **Default model** dropdown for installed small models. Models with reported sizes above 4B or unknown sizes are hidden. Selection verifies the precise count through `/api/show`, without running inference. If a candidate is not installed, the panel shows its explicit `ollama pull` command; it never runs the command automatically. Starting the daemon, installing a model, selecting it, and running inference are separate operations.

Install the runtime separately using its official instructions. The executable must be on the launcher's PATH, or specified under **Advanced**. Current profiles use `ollama serve`, `llama-server`, `vllm serve`, and `sglang serve`. Older SGLang versions that expose only the Python launch module need upgrading or can be started separately and connected as existing servers.

- [Ollama CLI and setup](https://docs.ollama.com/cli).
- [llama.cpp server options](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).
- [vLLM serving options](https://docs.vllm.ai/en/latest/cli/serve/) and [backend requirements](https://docs.vllm.ai/en/latest/getting_started/installation/gpu/).
- [SGLang quickstart](https://github.com/sgl-project/sglang/blob/main/docs/docs/get-started/quickstart.mdx).

All launches bind to `127.0.0.1`. Defaults are Ollama 11434, llama.cpp 8080, vLLM 8000, and SGLang 30000. Advanced settings allow a different port, executable, context length for non-Ollama engines, and startup timeout (default five minutes).

Loading can take time: **Starting** becomes **Running** only after model discovery succeeds. **Cancel startup** stops an owned loading process. Errors and bounded recent startup logs remain visible for diagnosis. A busy port produces an error; Draft.md does not terminate its occupant.

No runtime packages, drivers, or model weights are downloaded automatically. Hugging Face offline flags are set for local launches; use existing local model paths. Ollama cloud access is disabled for launches through this panel. Other runtime behavior still depends on the installed engine and version; this is not an operating-system network sandbox.

The bridge detects executable availability but does not certify hardware compatibility. vLLM/SGLang backend support varies by platform and installation. Runtime failures appear in Logs; use **Connect to existing** for a server running on a suitable machine. Initial launch profiles intentionally expose only a few options. Configurations requiring tensor parallelism, custom parsers, special GPU settings, or other flags can be launched externally and connected.

## Connect to an existing server

Choose **Connect to existing**, enter the API base URL and optional bearer API key, and press **Connect**.

| Engine    | Example API base URL        | Model discovery |
| --------- | --------------------------- | --------------- |
| Ollama    | `http://127.0.0.1:11434`    | `/api/tags`     |
| llama.cpp | `http://127.0.0.1:8080/v1`  | `/v1/models`    |
| vLLM      | `http://127.0.0.1:8000/v1`  | `/v1/models`    |
| SGLang    | `http://127.0.0.1:30000/v1` | `/v1/models`    |

Remote endpoints require HTTPS. For a remote HTTP server, create your own SSH tunnel and use its loopback address. Custom base paths are supported. Redirects are rejected rather than forwarding credentials elsewhere. The bridge makes direct connections without inheriting HTTP proxy environment variables.

Connect checks connectivity, credentials, and model discovery; it does not perform inference or verify tool-call support. Servers without these discovery routes are not supported by this first milestone. API keys remain in bridge memory until disconnect/shutdown and are never returned in status snapshots or saved in browser preferences. The input clears after a successful connection.

Live connections are session-only, with one active connection per engine. Non-secret launch profiles and model choices are remembered in browser preferences and reused on the next writing request. External server health and model lists are checked when connecting; disconnect/reconnect to refresh them. External compatible endpoints do not provide reliable parameter counts, so their model selection stays disabled; use a locally checked model path or Ollama's model metadata to enforce the budget. Credentials must be entered again after a bridge restart for authenticated endpoints. Manual model IDs and continuous external health monitoring remain planned.

## Process ownership and shutdown

**Stop** and **Cancel startup** terminate only a process group created by this bridge. **Disconnect** removes an external connection and does not stop its server. An existing Ollama desktop/OS service should be connected as external.

Closing settings, a tab, or a browser window leaves owned servers running so other tabs can use them. `dmd stop`, restart, uninstall, SIGINT, and SIGTERM stop owned engine groups. Worker cleanup preserves the leader's process identity until termination completes. Killing the bridge forcibly, a machine crash, or an engine that detaches workers into new sessions may leave processes behind; automatic orphan recovery is not implemented yet.

Logs are bounded in memory and common bearer/key/password patterns are redacted. Avoid putting secrets in executable paths or model paths. Arbitrary runtime output cannot be guaranteed free of secrets; inspect it before sharing.

## Try this branch locally

Build and package the branch:

```sh
npm run build
npm run package:release
```

Install the local archive rather than downloading the published release:

```sh
python3 packaging/installer.py --archive release/draft-md-0.0.1.tar.gz
```

Save your work and run `dmd restart`, then open **Settings → AI Agent**. This updates the local installation; it does not publish a release. Development/preview servers serve the static UI and show an installed-app requirement in this panel.

## Write with AI Agent

Type an instruction in the note and press **⌘/Ctrl+Enter** to replace that line with generated writing. Select text to improve it, or use the shortcut on a blank line to continue. There is no writing panel or agent toolbar button. A small status appears in the document footer during generation; **Esc** cancels client waiting and insertion.

`@agent write something here` uses the remembered default. Engine-specific mentions work too. Each output is one undoable edit. If the note changes during generation, the footer offers **Review draft** and manual insertion instead of overwriting those changes.

Change the model through **Settings → AI Agent**. A checked local path is saved immediately; future writing starts the server automatically. Ollama reconnects to a running local service or starts the installed daemon when needed. Ollama downloads the chosen supported small model on first invocation and reports progress in the footer. Other engine weights and runtime installation remain manual.

The [writing harness](agent-writing-harness.md) adds writing rules and bounded current-note context. It makes one chat request, with a 512-token output limit and 120-second timeout. **Stop · Esc** or pressing Escape cancels client waiting and prevents insertion; the engine may finish its bounded request in the background. Ollama unloads the model after generation. Multi-step tools and streaming remain planned.

## Verification

`npm run test:cli` exercises installed-launcher authentication and fake inference processes for all four launch profiles, including discovery, cancellation, timeouts, crashes, busy ports, immediate restarts, external ownership, and credential redirect protection. No model weights, API credentials, or GPU are required. Playwright covers remembered choices, automatic path launch, direct writing, Undo, selection replacement, edit conflicts, the settings controls, and browser-only fallback. Real Ollama writing with an already installed 0.5B model passed before and after an immediate bridge/runtime restart on this machine. Other real engine/backend combinations still need testing before claiming production support.

### First-use Ollama downloads

Invoke `@ollama` and press ⌘/Ctrl+Enter. Draft.md starts or connects to an installed Ollama runtime, downloads LiquidAI/LFM2.5-2.6B if missing, shows a circular spinner and per-layer download percentage in the footer, verifies its parameter count, and begins streaming writing. Settings can override the model once. No fallback to unrelated installed models occurs. Escape stops waiting; invoke again to reuse cached download layers. Ollama itself must already be installed; other engines still require local model files.
