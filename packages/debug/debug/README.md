---
description: "The debug capability seam (ctx.debug): frozen debug vocabulary and branded ids, typed DebugError failures, the session state machine, and the language-provider registry, for users and maintainers composing IDE-level debugging."
kind: "package-reference"
---

# @deepseek-ai/dsh-debug

English | [中文](README.zh.md)

## Summary

Use `dsh-debug` to give the harness one debug capability seam. The package owns the frozen contracts every debug surface shares: branded ids (`DebugSessionId`, `DebugProviderId`, …), the request/provider/plan vocabulary, the typed `DebugError` taxonomy with stable codes, the five-state session state machine, and the language-provider registry that reserves provider ids and file extensions atomically. Session lifecycle (registry-backed list/get, launch/attach, compounds, live events, durable `debug/*` session events, and the `debugSessions` projection) mounts on this service in the later IDE-debugging tasks; until then this package exposes exactly the vocabulary, the state machine, and the registry.

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
| [`src/index.ts`](src/index.ts) | Plugin entry: `Debug` service (`registerProvider`/`provider`/`providers`), `ctx.debug` merge |
| [`src/brand.ts`](src/brand.ts) | The eight branded id types and their constructors |
| [`src/types.ts`](src/types.ts) | Frozen seam contracts and the `DebugErrorCode` union |
| [`src/error.ts`](src/error.ts) | `DebugError` (`HarnessError` subclass) with identity and remediation details |
| [`src/state.ts`](src/state.ts) | `advanceDebugState` and `debugTerminalOutcome` over the seven-event transition table |

</details>

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Session lifecycle is not mounted yet: launch/attach, the session registry, live events, durable `debug/*` session events, and the `debugSessions` projection land with the later IDE-debugging tasks on this branch.
- `DebugAttachPlan` and `DebugAttachTarget` are the seam's gap-filling definitions for the provider contract's referenced-but-underspecified attach shapes; their home is this package until the design document records them.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
