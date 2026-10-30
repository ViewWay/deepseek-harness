---
description: "The debug group map: the ctx.debug capability seam and its providers, adapters, and surfaces for IDE-level debugging, for users and maintainers navigating the group."
kind: "package-group"
---

# debug/ — IDE-level debugging

English | [中文](README.zh.md)

## Summary

The debug group gives agents and humans IDE-level debugging over one `ctx.debug` capability seam ([subsystem contract](../../docs/subsystems/debug.md)): launch and attach for Node.js/TypeScript, Python, Go, and Rust/C/C++ across local, SSH, and sandbox execution worlds, with breakpoints, stacks, variables, and bounded output. The shared `debug` package owns the seam vocabulary, the session state machine, the provider registry, and session events; the other packages provide adapters, providers, tools, and the Web/Desktop/CLI surfaces. The Debug Adapter Protocol stays behind the seam.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`debug/`](debug/README.md) | Defines the debug capability seam: branded vocabulary, typed errors, the session state machine, the provider registry, live events, durable `debug/*` session events, and the `debugSessions` projection | `ctx.debug` |

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tool layer dispatches the operation face end to end: `dsh-tool-debug` resolves every `debug_execution` and `debug_inspect` call through the `ctx.debug` backend registry onto the unified `DebugSessionOperations` contract, passes `memoryReference` anchors from inspection results into the memory and disassembly operations, and resolves `breakpoint_locations` against the adapter. Capability gating differentiates per provider in practice (upstream capability declarations, 2026-10: setVariable is universal, restartFrame is vscode-js-debug only, debugpy lacks memory read/write, delve lacks completions); the [adapter seam note](../../.agents/notes/proposed/architecture/2026-10-25-debug-adapter-seam.md) records the full matrix. The `capabilities/changed` channel exists at the backend level — emitted post-handshake and on DAP capabilities events — and its wiring into the domain event waits on the session-face composition; no UI gating is live in production yet.

</details>
