---
description: "Deterministic in-memory fake Debug Adapter Protocol adapter for testing the debug client stack without a language toolchain."
kind: "package-library"
---

# @deepseek-ai/dsh-fake-debug-adapter

English | [中文](README.zh.md)

## Summary

`dsh-fake-debug-adapter` plays a Debug Adapter Protocol peer inside the test process: it answers client requests from fixed fixture data and replays a script of injected conditions (stops, hangs, malformed frames, crashes, delayed events, stderr text, and a `runInTerminal` reverse request). Tests of the DAP client, handshake, and debug backend therefore need no real debugger. Message order follows the protocol: every request is answered by its response first, then the events the script schedules after it.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Create the adapter, feed it client messages with `write`, and consume adapter output with `read` (messages) or `readWire` (encoded frames; the only face that surfaces malformed chunks).

```ts
import { createFakeDebugAdapter } from '@deepseek-ai/dsh-fake-debug-adapter'

const adapter = createFakeDebugAdapter({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }] })
adapter.write({ seq: 1, type: 'request', command: 'initialize', arguments: {} })
await adapter.read() // initialize response with capability flags
await adapter.read() // initialized event
adapter.write({ seq: 2, type: 'request', command: 'launch', arguments: {} })
await adapter.read() // launch response
await adapter.read() // process event
await adapter.read() // stopped event at the first scripted stop
```

The script fields:

| Field | Effect |
|---|---|
| `capabilities` | Merges over the default `initialize` capability flags; unlisted flags are omitted, which DAP defines as unsupported |
| `stops` | Replayed one per advance trigger (`configurationDone` before launch, `launch`/`attach`, `continue`/`step*`, `restart`); an exhausted script emits `terminated` |
| `hang` | Listed commands never receive a response |
| `malformedAfter` | Emits one malformed wire chunk after the listed command's normal output |
| `delayedEvent` | Emits one event on an unref'd timer after the first received message |
| `crashAfter` | Crashes on receipt of the command: pending and later reads reject with `FakeDebugAdapterCrashError`, queued output is dropped, and later writes are ignored |
| `stderr` | Debuggee stderr recorded into `stderrText` when `launch`/`attach` is processed |
| `runInTerminal` | Emits a `runInTerminal` reverse request between the `launch`/`attach` response and the `process` event; client responses are recorded in `reverseRequestResponses` |

Inspection requests (`threads`, `stackTrace`, `scopes`, `variables`, `evaluate`) return deterministic fixture data, with the top stack frame placed at the most recent scripted stop. Unknown commands receive a `success: false` response, and request arguments missing required fields throw instead of being coerced.

## Known Limitations and Deferred Work

These limits define when the fake needs special care. They are current package constraints, not a task backlog.

- **Fixture data is fixed** — threads, scopes, variables, and evaluate results are constants; a consumer needing scripted inspection data should extend `FakeDebugAdapterScript` rather than assert around the fixtures.
- **In-memory only** — there is no stdio process mode yet; execution-world e2e coverage will add a launcher when it consumes this package.
- **Reverse requests are fire-and-forget** — the adapter records the client's `runInTerminal` response but does not gate the launch flow on it.
