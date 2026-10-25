---
description: "The Node.js/TypeScript debug provider registering on ctx.debug: launch and attach resolution into the frozen plan shapes, js-debug manifest with the GitHub-published SHA-256 digest, and loud node config validation, for maintainers composing Node debugging."
kind: "package-reference"
---

# @deepseek-ai/dsh-debug-node

English | [中文](README.zh.md)

## Summary

Use `dsh-debug-node` to give a composition Node.js and TypeScript debugging. The plugin registers one provider on `ctx.debug` (js/mts/tsx family extensions) and, when `ctx.debugAdapters` is composed, the verified js-debug manifest. `resolveLaunch` turns a request into the frozen `DebugLaunchPlan` — adapter command, DAP launch request, target process, `processControl` requirement, and an actionable failure hint; `resolveAttach` accepts exactly one of process id, inspector port, or URL. Provider options (`runtimeExecutable`, `runtimeArgs`, `autoAttachChildProcesses`, `sourceMaps`, `outFiles`, `console`) validate loud: unknown options fail, known ones map explicitly into the DAP request.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin after `dsh-debug` (required) and optionally `dsh-debug-adapter-manager`. The manifest pins js-debug v1.140.0 from its GitHub release archive; the SHA-256 is the digest GitHub publishes for the asset, and the same archive serves every platform (js-debug is pure JavaScript). Disposal releases the provider and manifest together.

Failures carry `DEBUG_INVALID_CONFIG` for request and option validation; adapter absence surfaces through the environment's adapter resolution as `DEBUG_ADAPTER_NOT_FOUND`/`DEBUG_ADAPTER_UNSUPPORTED`.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The archive's interior layout (`js-debug/src/dapDebugServer.js` as the DAP entry) follows the upstream documentation and the plan; this environment could not download the archive to list it, so it stays pending real e2e verification in the adapter-matrix task.
- `${webServer}`-style js-debug compound launch recipes, `attachForSourcemappedBreakpoints`, and the vscode-pwa remote targets are not modeled.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
