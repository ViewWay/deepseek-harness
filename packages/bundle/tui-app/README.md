---
description: "Interactive terminal UI profile for dsh: chat, split, and debug layouts over the same agent session, for users who prefer the terminal."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-app

English | [中文](README.zh.md)

## Summary

`dsh-tui-app` composes the TUI profile (`dsh --profile tui`): an interactive terminal UI over the same agent session, tools, and safety defaults as every other surface. The composition stacks `dsh-base` with the TUI app plugin, so the profile carries the full harness; the TUI adds three layouts (Chat by default, Split with F7, Debug with F6), colon-prefixed commands (`:debug`, `:break`), and session resume via `--session-id`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Start a new interactive session:

```sh
dsh --profile tui
```

Resume an existing session:

```sh
dsh --profile tui --session-id session-…
```

Ordinary text is a prompt; a leading `:` starts a command (`:help` for the list). The TUI runs in the same process as the agent session — no browser, no Remote layer, no extra ports.

-----

## Model Experience

None, as the composition bundle carries no model-facing content of its own; the stacked plugins own every model-visible surface.

#### KV Cache effect

The bundle adds nothing to the request prefix; the stacked plugins own any prompt-section or schema changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The TUI hosts one interactive session per process: there is no browser or Remote layer, no multi-session tab set, and no extra ports.
- The Debug layout's launch and attach commands answer `DEBUG_UNAVAILABLE` until the DAP session face lands; `tui-debug` owns that notice.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
