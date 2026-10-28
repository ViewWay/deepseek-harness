---
description: "Terminal debug panels, commands, source preview, and the $EDITOR handoff over the in-process ctx.debug seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-tui-debug

English | [中文](README.zh.md)

## Summary

Terminal debug panels, the `:debug` command family, source preview, and the `$EDITOR` handoff for the TUI. The pane folds the in-process `ctx.debug` event stream directly — no Remote layer — so the TUI runtime keeps zero PTY dependencies. Launch and attach surface the debug service's own `DEBUG_UNAVAILABLE` notice until the DAP session face lands; run-in-terminal requests are satisfied through `ctx.terminals` by the composition, not by this package.

## Table of Contents

- [Use this package](#use-this-package)
- [What it provides](#what-it-provides)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Use this package

Load the plugin through the composition that also provides `ctx.debug`; it skips itself when `ctx.debug` is absent. The plugin provides the optional `tuiDebugPane` service that `apps/tui` renders: the service owns `:` command parsing, the pane reducer and renderer, and the function-key table (f5, shift-f5, f9, f10, f11, shift-f11). `run` accepts raw `:` lines and returns false for non-debug and app-owned commands; `runKey` maps debug function keys; `openEditor` jumps to the current source location in `$EDITOR`.

## What it provides

- `parseDebugCommand` — the closed command family from the design 9.8.3 table, with `if` and `log` clauses and typed `DebugError` failures (`DEBUG_UNKNOWN_OPERATION`, `DEBUG_INVALID_CONFIG`).
- `createDebugPaneState` / `foldDebugEvent` / `renderDebugPaneLines` — the pure reducer and plain-text renderer over the closed `DebugEvent` union; empty sections stay invisible.
- `readSourceWindow` — the bounded source preview around a stopped location, capped at `DEFAULT_MAX_SCAN_BYTES` before failing with `SOURCE_WINDOW_TOO_LARGE`.
- `editorCommand` / `openInEditor` — the `$EDITOR` argv handoff (`+<line> file`), argv-only with no shell.
- `apply(ctx)` — the plugin: subscribes to `ctx.debug.events`, provides `tuiDebugPane`, and disposes both on unload.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

## Model Experience

None, as the package provides terminal-side debug panels and commands over already-logged events and assembles no model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Launch and attach answer `DEBUG_UNAVAILABLE`: the DAP session face has not landed for those operations, so the pane observes `ctx.debug` events without driving sessions.
- The pane carries no stop-location or failure-code channel; the normalizer-based consistency suites leave those groups empty on this surface.
- Run-in-terminal requests are satisfied through `ctx.terminals` by the composition, not by this package.
- Source preview is bounded by `DEFAULT_MAX_SCAN_BYTES` and fails with `SOURCE_WINDOW_TOO_LARGE` past the cap.
