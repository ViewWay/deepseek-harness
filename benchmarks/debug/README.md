# Debug session throughput

English | [中文](README.zh.md)

Measures the production `DapDebugBackend` (`@deepseek-ai/dsh-debug-dap`) over a
scripted in-process wire: one launch replays 10,000 console output events, then
25 stop/continue cycles each read a 20-frame stack page, one scope, a
20-variable page, and the bounded console ring. The endpoints assert the
console ring stays at its configured cap (128 entries) and the pages at their
requested windows, so the timing lines always describe a bounded surface.

- Workload: fixed synthetic constants inside the worker; no recorded sessions
  or toolchain adapters.
- Timing boundary: `ingestMs` covers `start()` through the launch handshake and
  all 10k output events; `cyclesMs` covers the 25 inspection-and-continue
  cycles afterwards. Both are whole-process wall clock with no storage waits.
- Memory endpoint: retained heap of the live backend after the final cycle
  (including the worker's fixed 10k frame and variable wire tables), budget
  24 MiB.
- Calibration reference: Apple M4 Pro; budgets apply the shared CI time scale
  and headroom via `ciTimeBudget`.

Run it with the shared benchmark runner:

```sh
pnpm run test:bench -t 'debug session throughput'
```

The semantic bound (ring eviction, page windows, stale-reference rejection at
volume) is pinned by `packages/debug/debug-dap/tests/throughput.spec.ts`; this
benchmark owns only the timing and retained-memory evidence.
