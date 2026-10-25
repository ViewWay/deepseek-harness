---
description: "Real-adapter debug e2e matrix harness: toolchain probing, skip-reason records, and SSH-world stubs."
kind: "package-library"
---

# @deepseek-ai/dsh-debug-e2e

English | [中文](README.zh.md)

## Summary

`dsh-debug-e2e` owns the real-adapter debug matrix. `skipWithoutAdapter` probes each language's toolchain and adapter override (`DSH_E2E_<LANGUAGE>_ADAPTER`) and returns a recorded skip reason — never a mock — when either is missing; Node and Python closed-loop specs self-skip that way until adapters are present, Go and Native record their skips explicitly, and the SSH spec pins the tunnel transport's attach-unsupported behavior until the ssh world fixture is wired. `launchFixture` fails loud while the full composition is pending.

## Known Limitations and Deferred Work

These limits define where the harness needs care. They are current package constraints, not a task backlog.

- **launchFixture fails loud by design** — the real composition (providers, adapter manager, execution worlds) lands with the full Task 25b matrix; a present adapter must not run against a half-wired harness.
- **SSH world is a stub** — the tunnel path asserts `DEBUG_ATTACH_UNSUPPORTED` without a reachable ssh service; the stdio-over-ssh fixture arrives with Task 25b.
- **No sandbox spec yet** — the sandbox lane lands with the full matrix.
