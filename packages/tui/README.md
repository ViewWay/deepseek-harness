---
description: "The tui group map: the terminal debug surface that folds the in-process ctx.debug stream for the tui profile."
kind: "package-group"
---

# tui/ — terminal debugging

English | [中文](README.zh.md)

## Summary

The tui group carries the TUI's debug surface: [`tui-debug`](tui-debug/README.md) provides the debug pane the TUI app renders — `:` commands, function keys, bounded panels, source preview, and the `$EDITOR` handoff — folding the in-process `ctx.debug` event stream with no Remote layer and no PTY dependency. The IDE-debug seam itself lives in the [debug group](../debug/README.md); this group is its terminal Consumer.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tui-debug`](tui-debug/README.md) | Debug pane service: command parsing, pane reducer and renderer, key table, `$EDITOR` handoff | `tuiDebugPane` (optional) |

The terminal contract is recorded in the [debug subsystem page](../../docs/subsystems/debug.md).

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
