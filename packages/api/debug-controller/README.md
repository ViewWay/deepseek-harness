---
description: "Remote debug control surface: session, execution, inspection, and breakpoint operations with a monotonic event replay cursor."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-debug-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-debug-controller` exposes the debug seam over authenticated Remote for Web and Desktop consumers. Unary methods follow the design's resource groups — session listing, execution control (continue/pause/step), inspection (stack, evaluation), and per-file breakpoint replacement — and `events(sessionId, after)` replays one session's sequenced events from a bounded ring using the monotonic `debugEventSeq` cursor. A cursor that fell behind the ring's retention answers with the `debug/event-cursor-expired` flow-control code so clients resynchronize instead of silently missing events. Editor file writes belong to a separate controller.

## Model Experience

Indirectly, through the debug tools' own results: debug operations and event replay reach the model only through those tool outputs.

#### KV Cache effect

Remote debug calls assemble no model requests, so no prompt prefix or cached context changes.

## Known Limitations and Deferred Work

These limits define where the controller needs care. They are current package constraints, not a task backlog.

- **Backend resolution is registration-based** — `ctx.debug.registerBackend` must be wired by the composition for execution and inspection methods; sessions without a registered backend answer `DEBUG_SESSION_GONE`.
- **Live continuation is composition-owned** — `events` replays retained history; streaming new events to a connected client arrives with the Remote event channel wiring.
- **No editor writes** — `writeText` and version-guarded file saves are the Task 17 controller's surface.
