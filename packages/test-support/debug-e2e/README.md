---
description: "Real-adapter debug e2e matrix harness: launchFixture composes the shipped orchestration with real js-debug and debugpy adapters; Go/Native record explicit skips; SSH stays a stub."
kind: "package-library"
---

# @deepseek-ai/dsh-debug-e2e

English | [中文](README.zh.md)

## Summary

`dsh-debug-e2e` owns the real-adapter debug matrix. `launchFixture(language, { file })` composes the shipped launch orchestration (`launchDebugSession`) with the real language provider, a real adapter, and the real `DapDebugBackend` — no mocks on any protocol path — registers the session backend through `ctx.debug.registerBackend`, and returns a handle (`setBreakpoints`/`continue`/`step`/`terminate`) over the live session. Node composes the managed js-debug DAP server over a loopback socket bridge (root connection, the reverse `startDebugging` handoff, and the second `__pendingTargetId` connection that carries the session); Python composes the debugpy adapter over stdio in its launch-first order, with the target interpreter owning the debugpy venv. `skipWithoutAdapter` decides availability without launching anything and returns a recorded skip reason — Go and Native are explicit skips this wave; the SSH spec pins the tunnel transport's attach-unsupported behavior.

## Adapter provisioning

Provisioning is terminal-side; the harness never downloads. Adapters live under `$DSH_E2E_ADAPTER_ROOT` (default `~/.cache/dsh/debug-adapters`) in the adapter manager's install layouts, and `$DSH_E2E_<LANGUAGE>_ADAPTER` overrides the resolved entry per language.

- **Node (js-debug 1.140.0)** — download `js-debug-dap-v1.140.0.tar.gz` from the release URL recorded in `@deepseek-ai/dsh-debug-node`'s manifest, verify its SHA-256 against that manifest, and extract so `js-debug/src/dapDebugServer.js` sits at `<root>/node/1.140.0/<platform>/` (platform keys like `darwin-arm64`). The fixture launches it as `node <that path> 0` (random port) and bridges the announced socket.
- **Python (debugpy 1.8.22)** — create a venv at `<root>/python/1.8.22/venv` with any interpreter and `pip install debugpy==1.8.22` into it; the venv's `bin/python` is both the adapter and the target interpreter, so the debugpy it owns is importable by the debuggee.

Set `DSH_E2E_TRACE=1` to mirror every adapter DAP event onto the test log.

## Known Limitations and Deferred Work

These limits define where the harness needs care. They are current package constraints, not a task backlog.

- **Go/Native are explicit skips** — the `dlv`/`lldb-dap` closed loops land with the adapter-matrix follow-up; a present toolchain never promotes them to a run, and `launchFixture` fails loud if reached.
- **SSH world is a stub** — the tunnel path asserts `DEBUG_ATTACH_UNSUPPORTED` without a reachable ssh service; the stdio-over-ssh fixture arrives with the ssh-world task.
- **Python runs without installed capabilities** — debugpy's launch-first order bypasses `DapDebugBackend.start`, so capability-gated operations fall back (terminate degrades to disconnect) until the handshake grows an early-launch order.
- **No sandbox spec yet** — the sandbox lane lands with the full matrix.
