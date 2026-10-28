---
description: "DAP wire support for the debug seam: Content-Length frame codec, byte transports, and the request client."
kind: "package-library"
---

# @deepseek-ai/dsh-debug-dap

English | [中文](README.zh.md)

## Summary

`dsh-debug-dap` speaks the Debug Adapter Protocol wire format for the debug seam: it encodes and decodes `Content-Length` frames, adapts adapter stdio pipes and tunnel sockets into one `DebugTransport` shape, and correlates requests with responses through `DapClient`. The client resolves every well-formed response — including `success: false` — so failure policy stays with the handshake and session backend built on top. All rejections are `DebugError` values with stable codes: `DEBUG_TIMEOUT` for aborted requests, `DEBUG_SESSION_GONE` for disposal, adapter exit, and send failures, and `DEBUG_MALFORMED_RESPONSE` for protocol violations, which also kill the client.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Wrap a transport in a client, send requests, and subscribe to events and reverse requests.

```ts
import { DapClient, createStdioTransport } from '@deepseek-ai/dsh-debug-dap'

const client = new DapClient(createStdioTransport(adapterProcess))
client.onEvent(event => console.log(event.event))
client.onReverseRequest(async request => ({ processId: 42 }))
const response = await client.request('initialize', {
  clientID: 'dsh',
  linesStartAt1: true,
  columnsStartAt1: true,
  pathFormat: 'path',
}, AbortSignal.timeout(5000))
await client.dispose()
```

Contracts that matter to callers:

- **Frames** — `encodeDapFrame`/`decodeDapFrames` follow the DAP base protocol; a rejected header, body, or per-frame byte limit (default 1 MiB, overridable per call) is `DebugError('DEBUG_MALFORMED_RESPONSE')`, and a partial frame returns as `rest` for reassembly.
- **Transports** — `createStdioTransport(process)` takes an object with the adapter's `stdin`/`stdout` streams; `createTunnelTransport(socket)` takes a connected duplex socket. Transports never spawn or connect anything; execution worlds own process and tunnel lifecycles.
- **Client** — requests carry a monotonic sequence and accept an `AbortSignal` built from the caller's configured timeout. Adapter-initiated requests are answered through the registered reverse-request handler, or with an unsupported failure when none is registered, so an adapter never hangs. Listener throws and reverse-answer send failures are contained; they never break the reader loop.
- **Terminal states** — after malformed input or an unmatched response the client is dead and every later request rejects with the stored `DEBUG_MALFORMED_RESPONSE`; after adapter output ends, disposal, or a failed send, requests reject with `DEBUG_SESSION_GONE`.
- **Handshake** — `initializeDebugAdapter` runs the specification order (initialize with `linesStartAt1`/`columnsStartAt1`/`pathFormat: 'path'`, wait `initialized`, `setBreakpoints`/`setExceptionBreakpoints`, `configurationDone` only when the raw response declared it, then `launch`/`attach`) and resolves with `mapCapabilities`-normalized capabilities plus the first stop. `mapCapabilities` defaults every undeclared flag to false, per the protocol's absence-means-unsupported rule.
- **Backend** — `DapDebugBackend` exposes the session operations without any raw DAP: it tracks stops (fetching the frame's source for each snapshot), invalidates frame and variable references across every resume with `DEBUG_STALE_REFERENCE`, gates undeclared operations with `DEBUG_UNSUPPORTED_CAPABILITY` before sending, rejects inspection while running with `DEBUG_NOT_STOPPED`, and keeps a bounded console ring paged by a non-consuming `nextOffset` cursor. `continue`/`step` wait one resume window for the next stop and otherwise report `{ kind: 'running' }`; an explicitly rejected command fails with `DEBUG_LAUNCH_FAILED` carrying the adapter's message.

## Known Limitations and Deferred Work

These limits define where the library needs care. They are current package constraints, not a task backlog.

- **No request serialization** — the client sends concurrently; the per-session serial queue from the debug seam design belongs to the session backend, not the wire client.
- **No reverse-request capability gating** — the client dispatches every adapter-initiated request it can parse; permission checks live in the backend layer.
- **No adapter stderr channel** — stdio transports carry only the frame pipes; adapter stderr collection is owned by the launch orchestration.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
