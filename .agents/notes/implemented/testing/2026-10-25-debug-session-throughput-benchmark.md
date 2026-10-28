# Agent Note: Debug session throughput benchmark — why timing owns the bench and bounds own the package tests

Status: implemented

English | [中文](2026-10-25-debug-session-throughput-benchmark.zh.md)

Scope: this note owns the workload, timing boundary, memory endpoint, calibration reference, and exclusions of `benchmarks/debug/session-throughput.bench.ts`, per the benchmark-tree rule that an owning Agent Note records them.

## Problem

Task 27 needed bounded-performance evidence that a debug session stays cheap while a debuggee prints a large log and the agent pages through stops: 10k console lines and 10k-frame/variable tables crossing one `DapDebugBackend` through repeated stop/continue cycles. The repository splits this evidence by owner: semantic bounds (ring eviction, page windows, stale-reference rejection) are behavior and live in package tests, while the benchmarks tree owns only timing and retained-memory evidence and rejects benchmark completion that duplicates semantic assertions.

## Decision

The benchmark drives the production `DapDebugBackend` and `DapClient` from the built `lib/` entries of `@deepseek-ai/dsh-debug-dap` over a scripted in-process wire — the same wire shape a real adapter speaks, so no test-support fake enters the benchmarks tree. One launch replays 10,000 output events; then 25 stop/continue cycles each read a 20-frame stack page, one scope, a 20-variable page, and the bounded console ring. The worker verifies its endpoints reached their caps (ring at 128, pages at 20) before reporting, so every timing line describes a bounded surface.

**Workload.** Fixed synthetic constants inside the worker: 10,000 frame and 10,000 variable wire tables, 10,000 console lines, 25 cycles, page 20, console ring 128. No recorded sessions, toolchains, or network.

**Timing boundary.** `ingestMs` spans `start()` through the launch handshake and all 10k output events; `cyclesMs` spans the 25 inspection-and-continue cycles afterwards. Whole-process wall clock, no storage or paced waits (`ioShare: 0`).

**Memory endpoint.** Retained heap of the live backend after the final cycle, including the worker's fixed wire tables, budget 24 MiB.

**Calibration reference.** Apple M4 Pro measured ingest ≈ 25 ms and cycles ≈ 49 ms; budgets 40 ms and 80 ms before the shared CI time scale and headroom.

## Alternatives considered

Reusing `@deepseek-ai/dsh-fake-debug-adapter` as the driver was rejected: its fixtures are fixed at a handful of entries, driving 10k volume would mean extending a test-support surface for a benchmark, and the benchmarks tree requires production entry points. Duplicating the cap assertions only inside the benchmark was rejected for the same rule in reverse — `packages/debug/debug-dap/tests/throughput.spec.ts` owns the semantic bounds and the benchmark owns timing and memory.

## Consequences

The bench stays small (one worker, one bench file) and exercises the same paging path the fake-adapter e2e matrix covers semantically. The cost: the wire tables are synthetic DAP shapes maintained by hand in the worker, and the retained-heap endpoint includes those tables, so the 24 MiB budget covers driver plus backend rather than the backend alone.
