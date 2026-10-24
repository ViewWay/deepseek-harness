---
description: "The debug capability seam (ctx.debug): frozen debug vocabulary and branded ids, typed DebugError failures, the session state machine, the provider registry, the workspace-scoped session registry with live events, compounds, durable debug events, and the debugSessions projection, for users and maintainers composing IDE-level debugging."
kind: "package-reference"
---

# @deepseek-ai/dsh-debug

English | [中文](README.zh.md)

## Summary

Use `dsh-debug` to give the harness one debug capability seam. The package owns the frozen contracts every debug surface shares: branded ids (`DebugSessionId`, `DebugProviderId`, …), the request/provider/plan vocabulary, the typed `DebugError` taxonomy with stable codes, the five-state session state machine, the language-provider registry that reserves provider ids and file extensions atomically, the workspace-scoped session registry with live events and idempotent teardown, compound configurations with a stop-all policy, the durable `debug/*` session events with the `debug` message source, and the `debugSessions` projection registered on `ctx.sessionProjections`. Launch and attach reject with `DEBUG_UNAVAILABLE` until the DAP backend lands; writers for the durable events arrive with it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this service to own `ctx.debug`. A language provider registers with its branded id, display name, file extensions, adapter descriptor, config schema, and the two explicit resolve steps (`resolveLaunch`/`resolveAttach`) that turn a request into a fully resolved plan. Registration validates everything before mutating: an empty id, an empty or malformed extension list, or duplicate extensions fails with `DEBUG_INVALID_PROVIDER`; a reserved id or extension fails with `DEBUG_CONFLICT`; the returned disposer releases every reservation together, so an HMR reload leaves no stale routes.

The session state machine is the single transition table every session follows: `starting → running ⇄ stopped` with terminal absorption in `terminated`/`failed`, where repeated `terminate`/`disconnect` is idempotent. Illegal combinations throw `DebugError` with `DEBUG_INVALID_STATE`; callers branch on `code` and read `providerId`/`sessionId`/`workspaceId`/`detail` when present, never on `message`.

Registered sessions live in the workspace-scoped registry behind `ctx.debug.sessions`: `list`/`get` read it, `events` publishes live `session/*`, `breakpoint/changed`, `console/output`, `adapter/output`, and `capabilities/changed` notifications only after the owning state committed, and teardown disposes exactly once before publishing `session/terminated`. Cross-workspace reads fail with `DEBUG_WORKSPACE_MISMATCH`. Compounds group an ordered session list with a stop-all policy and aggregated state.

Durable debug facts use the `debug/session-started`, `debug/stopped`, `debug/session-ended`, and `debug/control` session events, all written with the `ignorable: true` envelope so readers without this plugin skip them safely; `SESSION_FORMAT_VERSION` does not change. Payloads carry only ids and audit facts — never variable values, memory, environment values, or DAP frames — and ids travel as their serialized string form, so replay never treats them as live handles. The `debugSessions` projection folds those events into a bounded view (Config: `maxProjectedSessions`, `maxProjectedStops`) for reconnection and session lists; it never enters the system prompt. The `debug` message source attributes model-visible notices this seam's consumers inject.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **Frozen contract.** `src/types.ts` carries the reviewed contracts verbatim (Shared Interfaces + design section 4, review resolutions of 2026-10-25); any drift is a contract change that updates the design and plan first.
- **Branded ids only.** All cross-boundary ids are `Branded<B>` values from `dsh-brand`. DAP's numeric `threadId`/`frameId`/`variablesReference`/`breakpoint.id`/`sourceReference` convert to and from branded values only inside the `debug-dap` backend; this package's public types carry no bare numeric ids.
- **Atomic registration.** `registerProvider()` normalizes extensions (lowercase, leading dot), rejects intra-provider duplicates, then conflict-checks id and extensions before one `ctx.effect()` commits both reservations; the generator's cleanup releases them together.
- **Exhaustive machine.** `advanceDebugState` reads a total `Record<DebugSessionState, …>` table and throws typed failures for unlisted pairs; `debugTerminalOutcome` switches over the closed event union with a compile-time exhaustiveness guard.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Debug` service (`registerProvider`/`provider`/`providers`, `sessions`, `list`/`get`, `events`, launch/attach guards), `ctx.debug` merge |
| [`src/brand.ts`](src/brand.ts) | The eight branded id types and their constructors |
| [`src/types.ts`](src/types.ts) | Frozen seam contracts, the `DebugErrorCode` union, and the inspection vocabulary (stack, variables, evaluate, breakpoints, exceptions, modules, disassembly, memory, console) |
| [`src/error.ts`](src/error.ts) | `DebugError` (`HarnessError` subclass) with identity and remediation details |
| [`src/state.ts`](src/state.ts) | `advanceDebugState` and `debugTerminalOutcome` over the seven-event transition table |
| [`src/events.ts`](src/events.ts) | Live `DebugEvent` union, `DebugEventSource`, and the contained-dispatch bus |
| [`src/registry.ts`](src/registry.ts) | Workspace-scoped session registry with commit-then-publish and idempotent removal |
| [`src/session.ts`](src/session.ts) | `DebugSessionRecord` and the live-session teardown face |
| [`src/compound.ts`](src/compound.ts) | Compound sessions with stop-all propagation and aggregated state |
| [`src/session-events.ts`](src/session-events.ts) | Durable `debug/*` session-event payloads and the `debug` message source |
| [`src/projection.ts`](src/projection.ts) | The bounded `debugSessions` projection and its retention-bounds factory |

</details>

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Launch and attach reject with `DEBUG_UNAVAILABLE`, and no component writes the durable `debug/*` events yet; the DAP backend and durable event writing land with the later IDE-debugging tasks on this branch.
- `terminate` and `disconnect` on a live session share one teardown path; the two distinct DAP requests, `restart` on compounds, and the session's inspection methods (typed by the exported vocabulary) arrive with the backend.
- `DebugAttachPlan` and `DebugAttachTarget` are the seam's gap-filling definitions for the provider contract's referenced-but-underspecified attach shapes; their home is this package until the design document records them.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
