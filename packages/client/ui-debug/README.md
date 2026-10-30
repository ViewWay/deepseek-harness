---
description: "Debug toolbar, view store, panels, and conversation tool cards for the Web/Desktop workbench."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-debug

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-debug` is the debug workbench's view layer: the capability-gated toolbar, the client-side fold of live debug events, the stack/variables/watch/breakpoints/console/modules/loaded-sources/disassembly/memory/exception-filter panels, the adapter settings panel, the debug view summary panel, and the four debug tools' conversation cards. The client plugin also provides the debug view client service (`ctx.debugView`): the live store seeded from the controller's session list, kept current by polling the event replay ring, and the toolbar action dispatch onto the controller's execution Remotes. Every view piece stays a pure presentation of its inputs — state, rows, and capability flags arrive as props, and every gesture leaves through a callback.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Use this package

### Folding live events

`createDebugViewStore` folds the debug controller's event payloads into one immutable view state: the selected session/thread/frame, reported capabilities, thread list, lazy variable expansion set, watch expressions, and the bounded console ring with its cursor. `subscribe` turns the store into an external store, so React surfaces re-render per transition. A continue or termination clears the stop, frame, and variable references and marks the stack and variables stale, so panels describe the previous stop instead of presenting it as current. `visibleDebugActions` derives the toolbar's controls from the reported capabilities, so an adapter that lacks a feature never shows the control that would fail. `debugViewEventOf` in `wire-events.ts` is the wire projection: it narrows one replay record's JSON payload onto the fold event, maps the domain's `session/starting`/`running`/`failed` kinds onto session states, folds a `session/stopped` payload's stop fields when it carries them, and skips payloads the view cannot present.

### Driving the controller

`createDebugViewService` (provided as `ctx.debugView` by the client plugin) seeds the store from `remote.debug.sessionList`, then polls `remote.debug.events(sessionId, cursor)` per known session on the configured `debugEventPollMs` interval (default 1000ms, minimum 250ms); the forwarded-event allowlist has no `debug/*` entry, so polling is the honest transport. A cursor the ring has outgrown resets to zero and the next tick refolds the retained history. `onAction` dispatches the toolbar gestures: `continue`/`pause` map to their Remotes, the four step kinds map to `executionStep`, and `restartFrame` uses the store's selected frame. `start`, `restart`, `stop`, and `disconnect` have no controller Remote yet and surface an `action-unavailable` notice, as do dispatch refusals and poll failures through the bounded notice store.

### Rendering the toolbar

`DebugToolbar` renders the gated run controls, the session and thread selectors, the agent-stop notification toggle, and the actor indicator. Without reported capabilities it renders the selectors, toggle, and indicator only.

### Rendering panels

Panels in `panels.tsx` are individually exported: stack, variables, watch, breakpoints, exception filters, console, modules, loaded sources, disassembly, memory, and the adapter settings rows (version, platform, license, SHA-256, install/update/uninstall/self-test, override path, busy state). Capability-gated panels return nothing when support is absent; variable values truncate at a bounded length and keep lazy expansion as the way to see the rest; one failing watch expression shows its own error without blocking the others.

### Conversation cards

`debugToolCard` projects one debug tool call's logged arguments onto the generic card model — title, bounded summary, and stop locations — and malformed or unknown payloads degrade to the bare generic shape. The client plugin registers the four tool names (`debug_session`, `debug_breakpoints`, `debug_execution`, `debug_inspect`) through `tool.call.toolview`, so Session replay renders the same card from the same logged slice, and unregistered names fall back to the transcript's generic row.

## Understand the implementation

- `store.ts` keeps client-plane values — plain ids and paths as the debug controller's event ring carries them; branded seam ids never cross the Remote, so no conversion lives here.
- The toolbar and panels never await Remote calls; the debug view client service owns the Remote traffic, and the workbench layout package composes its outputs.
- All copy lives in the typed `debug` locale dictionaries across the eight shipped languages; no product string is hardcoded.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

## Model Experience

None, as this package renders debug views in the browser and registers nothing model-facing.

#### KV Cache effect

None; the cards are pure projections of already-logged tool arguments and assemble no model request.

## Known Limitations and Deferred Work

- The debug Remote carries no launch, restart, terminate, or disconnect method yet; those toolbar actions report `action-unavailable` until the controller gains them, and hover evaluation stays deferred.
- Watch expression editing is routed through callbacks; the workbench owns the input surface.
- Disassembly and memory are read-only views; memory writes stay absent per the design's default-off rule.
