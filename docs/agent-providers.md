# Writing providers

All providers use the same document-native flow: type a mention and instruction on its own line, then press **⌘/Ctrl+Enter**. Writing streams into that range; **Escape** stops it and **Undo** reverses the generated passage. If you edit the note during generation, automatic insertion stops and a completed draft can be recovered. There is no agent chat panel.

| Mention | Connection | Authentication and model |
| --- | --- | --- |
| `@agent` | Your saved default | Choose once in Settings → AI Agent → Default for @agent |
| `@codex` | Installed Codex CLI, app-server over stdio | Existing Codex CLI login and configured model |
| `@claudecode` | Installed Claude Code CLI, print-mode stream | Existing Claude Code login and configured model |
| `@chatgpt` | ChatGPT website through the browser extension | Signed-in `chatgpt.com` session and website model |
| `@claude` | Claude website through the browser extension | Signed-in `claude.ai` session and website model |
| `@ollama`, `@llama.cpp`, `@vllm-engine`, `@sglang` | Configured inference engine | See [local model setup](local-models.md) |

There is no fallback from a requested provider to another provider. `@claude` means the website; `@claudecode` means the installed CLI. No OpenAI or Anthropic API key entry is added for these integrations. A local CLI can itself use the authentication/provider configuration you already gave it. The 4B parameter limit applies to local inference models, not to models served by your CLI account or website.

## Installed CLIs

Install and sign in with each CLI using its own instructions. Ensure `codex` and `claude` are on the PATH used to launch `dmd`. If you installed a CLI after launching Draft.md, restart Draft.md.

```text
codex login
claude auth login
```

Then write, for example:

```text
@codex turn this outline into a short introduction
@claudecode rewrite this paragraph more clearly
```

Settings → AI Agent shows whether each CLI is installed. You only need to choose a default there if you want `@agent` to use it; an explicit mention runs that provider directly.

The bridge uses [Codex app-server's thread/turn protocol and agent-message delta events](https://developers.openai.com/codex/app-server), and [Claude Code's streaming print mode](https://code.claude.com/docs/en/headless). Neither route substitutes an API integration for the installed application.

Each request runs in a fresh temporary working directory. Codex uses an ephemeral thread, read-only sandbox, disabled shell/unified execution, disabled hooks/apps, an empty MCP configuration, and the writing harness as its base instructions. Approval/tool requests are rejected. Claude Code uses an empty built-in tool list, strict empty MCP configuration, disabled slash commands, disabled transcript persistence, and safe mode where supported. See the [Claude Code CLI options](https://code.claude.com/docs/en/cli-reference). These sessions produce text for the editor; file operations are not writing tools. Managed provider policy and account limits still apply.

Escape sends an authenticated cancel request and terminates the owned process group. Disconnecting the response also terminates the process when the next chunk/heartbeat is written. `dmd stop` cleans up active owned agent processes. Requests time out after five minutes and keep already inserted text.

## ChatGPT and Claude websites

This is a Manifest V3 Chrome/Chromium extension, separate from the Draft.md application. It uses the ordinary website composer and rendered response in a dedicated tab. It does not use private API endpoints, intercept authentication tokens, read cookies, or bypass sign-in or account restrictions. The implementation uses [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) and extension messaging.

### One-time installation

1. Run the installed Draft.md app with `dmd` and open its printed address.
2. In Settings → AI Agent choose **ChatGPT · website** or **Claude · website**, then download the extension ZIP and unzip it. The installed app serves the ZIP at `/website-extension.zip`.
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the unzipped folder containing `manifest.json`.
4. Return to the Draft.md tab. Click the extension icon and choose **Connect this tab**. Pairing is restricted to that exact loopback origin and port. If the tab was already open when the extension was installed, reload it once so its content script is attached.
5. Sign in at `https://chatgpt.com` or `https://claude.ai` in the same Chrome profile. On first invocation, check the dedicated website tab if sign-in is required, then invoke again.

In a source checkout, you can load `extension/website` directly. Installed packages also contain `current/website-extension` under the Draft.md installation directory. The release ZIP is `release/website-extension.zip`. Reload the extension in `chrome://extensions` after updating its files.

Examples:

```text
@chatgpt write a short project summary
@claude turn these notes into a checklist
```

The extension opens its own tab, submits the prepared writing request, watches the generated response, and converts supported rendered headings, lists, checkboxes, tables, formatting, and code back to Markdown. It reuses its own provider tab for later requests, starting a fresh website conversation. It leaves existing user conversations alone and refuses to overwrite a nonempty composer. The source conversation remains in the provider website's history according to that website's settings.

The extension asks for storage and active-tab permissions and declares content scripts only for loopback Draft.md pages, `chatgpt.com`, and `claude.ai`. It stores paired origins, not prompts or responses. Pairing another origin requires another click in the extension. Its provider content script only responds to jobs from its own extension background worker.

### Current website limits

Website adapters are experimental: there is no stable DOM contract with either website. English composer/send/stop selectors and common response structures are supported; a changed layout, account variant, challenge, rate limit, or sign-in page can prevent a request. The app reports an error and keeps the partial draft. Open the dedicated provider tab to resolve the website state. No CAPTCHA or account check is bypassed. The provider model and its thinking settings are chosen on its website; the local model's first-token timings do not apply.

The initial bridge requires the installed Draft.md launcher for the shared writing harness. Static-only hosting does not yet support these website adapters. Website requests send the instruction, bounded current-note context, and selection to the selected website; CLI requests send them through the selected CLI's configured provider. Unseen workspace files are not supplied by Draft.md.

## Verification

Both real installed CLIs were exercised on this machine and streamed checkbox writing with their existing logins. Automated fake-process tests cover protocol streaming, failures, cancellation, process cleanup, and prompt bounds. Browser tests cover mention routing, saved defaults, inline insertion/Undo, and a missing extension. A loaded Chromium extension is tested against controlled ChatGPT/Claude DOM fixtures, including unpaired-origin rejection and streamed checkbox conversion. These fixtures do not establish compatibility with every current live signed-in website variant; live account verification remains a user-side check.
