---
description: "The debug group map: the ctx.debug capability seam and its providers, adapters, and surfaces for IDE-level debugging, for users and maintainers navigating the group."
kind: "package-group"
---

# debug/ — IDE-level debugging

English | [中文](README.zh.md)

## Summary

The debug group gives agents and humans IDE-level debugging over one `ctx.debug` capability seam: launch and attach sessions for Node.js/TypeScript, Python, Go, and Rust/C/C++ across local, SSH, and sandbox execution worlds, with breakpoints, stacks, variables, and bounded output. The shared `debug` package owns the seam vocabulary, the session state machine, the provider registry, and session events; the other packages provide debug adapters, providers, tools, and the Web/Desktop/CLI surfaces. The Debug Adapter Protocol stays behind the seam; no client consumes it directly.

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

None.

</details>
