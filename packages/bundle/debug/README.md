---
description: "Optional debug composition for dsh: the ctx.debug seam, four language providers, agent debug tools, the Remote controller, and the Web/Desktop workbench over any dsh-base profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-debug-bundle

English | [中文](README.zh.md)

## Summary

`dsh-debug-bundle` composes the IDE-level debug capability as one official optional bundle: the `ctx.debug` service seam, the DAP wire stack, the adapter manager, the four language providers (Node.js/TypeScript, Python, Go, Rust/C/C++), the model-facing `debug_*` tools, the Remote debug controller for the Web/Desktop workbench, and the editor and panel client plugins. It is registered in `OPTIONAL_BUNDLES` and stays switched off until the plugin manager enables it; no shipped profile selects it (see the [debug subsystem page](../../../docs/subsystems/debug.md)).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Enable the bundle through the plugin manager (the Web/Desktop Plugins page) or `dsh plugin`. Enabling it mounts the debug seam, providers, and tools in the running profile; the workbench rows activate only in the `web` and `desktop` profiles, while headless, SDK, and ACP deployments load the model side only.

Adapter binaries are never installed with the bundle. The adapter manager resolves the language adapter on first use, verifies its SHA-256 digest, and installs it into a managed location; a deployment that prefers its own toolchain overrides the adapter command per provider.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Patch surface over base

One `insert` block stacks eleven rows over the profile: `debug` (the seam), `debug-adapters`, the four `debug-provider-*` rows, `tool-debug`, `debug-controller` (the bundle re-exports the controller as a default plugin because the controller package exports only named classes), and the three workbench rows `ui-code-editor`, `ui-debug`, and `ui-workbench`. The workbench rows carry a profile guard that disables them outside `web` and `desktop`, so headless, SDK, and ACP deployments load only the model side.

### Source map

- `cordis.patch.yml` — the rows above.
- `src/debug-controller.ts` — the default-plugin re-export of `DebugController`.
- `locale/*.json` — the plugin-manager display metadata for the eight shipped languages.
- `icon.svg` — the plugin-manager glyph.

-----

<a id="model-experience"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The bundle owns composition only: no debug behavior lives here. The service face, DAP client, adapter manager, providers, tools, controller, and client plugins each own their READMEs.

</details>

## Model Experience

### debug tools

#### What the model sees

The four `debug_session`, `debug_execution`, `debug_inspect`, and `debug_breakpoints` tools with their fixed system-prompt section come from the stacked `tool-debug` row; the bundle itself adds no prompt text.

#### Token effect

Owned entirely by the stacked plugins; the bundle adds nothing of its own.

#### KV Cache effect

None from the bundle; the tool schemas and prompt section belong to `tool-debug`.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits tell you what to expect after enabling the bundle. They are current package constraints, not a task backlog.

- **Launch/attach need an approval answerer** — deployments without one reject launch and attach fail-closed (`DEBUG_APPROVAL_DENIED`); the tools distinguish an active rejection from a missing answerer in the error detail.
- **The workbench needs a GUI profile** — the editor, panel, and workbench rows stay switched off in headless, SDK, and ACP; enabling the bundle there contributes the agent tools only.
- **Adapters install on demand** — the first debug session in a language downloads and verifies its adapter; air-gapped deployments must provide adapter commands through provider overrides before launch.
- **Designer review of the icon is pending** — the glyph follows the official artwork constraints and passes `verify-package-meta`, but a designer has not approved the new mark yet.
