---
description: "Deterministic three-surface debug scenarios: one canonical fact timeline driven through the web view store, the TUI pane reducer, and the headless NDJSON projection with a shared normalizer, for maintainers writing or reviewing debug consistency tests."
kind: "package-library"
---

# @deepseek-ai/dsh-debug-scenarios

English | [中文](README.zh.md)

## Summary

Use `dsh-debug-scenarios` to prove the debug surfaces agree. `debugScenario` builds one deterministic fact timeline, and `runScenario` drives it through each surface's real harness: the web view store, the TUI pane reducer over the live `DebugEvent` union, and the headless `projectJsonRun` NDJSON projection. `normalizeSurfaceEvents` strips presentation-only fields and groups what each surface's channel retained, so one test compares lifecycle facts across all three surfaces and the richer facts on the pairs whose channels carry them. Ids come from `dsh-debug-fixture`; test support only, registering nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Build a scenario by name and run it on each surface. `debugScenario('basic')` launches by the agent, sets a verified breakpoint plus one adapter-rejected line, takes a breakpoint, step, and exception stop, resumes between stops, and terminates by the agent; `debugScenario('human-agent-handoff')` stops once and hands the terminate to the user. Options override the language, source file, stop sequence, ending outcome, and id seed. `runScenario(surface, scenario)` returns the surface's fold output — the store state, pane state, or NDJSON lines — for presentation-level assertions, and `normalizeSurfaceEvents(run)` returns the grouped records (`sessions`, `stops`, `breakpoints`, `controls`, `failures`) with session id, state, stop reason, relative location, breakpoint verification, error code, and control actor kept. A surface without a channel for a fact family emits an empty group.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The TUI pane carries no stop-location or failure-code channel yet, and the web store carries no terminal actor; the normalizer leaves those groups empty on those surfaces until the session face publishes the missing facts.
- Headless breakpoint verification has no durable channel — breakpoint results live only in the live event stream and the web set-file response — so the headless breakpoint group stays empty.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The scenario timeline is the durable-commit granularity, so every fact maps to the seam's committed facts and no surface sees an event the session log could not reconstruct.

</details>
