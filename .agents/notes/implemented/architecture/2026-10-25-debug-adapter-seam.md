# Agent Note: Debug adapter seam — DAP, execution worlds, and per-session control

Status: implemented

English | [中文](2026-10-25-debug-adapter-seam.zh.md)

Scope: this note owns the durable rationale for IDE-level debugging in Harness. The subsystem contract, panel inventory, and bounds live in [docs/subsystems/debug.md](../../../../docs/subsystems/debug.md); this note records why the boundaries hold and what was rejected.

## Problem

Harness had no debugger for user programs. A debugging capability has to satisfy four demands at once, each pulling against a standing rule: a person and an Agent must observe one identical session state; four languages (Node/TypeScript, Python, Go, Rust/C/C++) across three execution worlds (local, SSH, sandbox) share no debugger API beyond DAP; a debugger executes arbitrary code inside the target process; and adapters are third-party binaries with platform-specific licenses, checksums, and OS privileges.

## Decision

**One seam, DAP stays in one package.** `ctx.debug` is the Service Definition; language providers, `dsh-tool-debug`, the Remote controller, and the Web/Desktop/TUI surfaces are separate roles. DAP framing, handshake, capability projection, and reverse requests exist only in `dsh-debug-dap`; the normalized model never carries a raw DAP request or response, so no escape hatch reaches the protocol past permission, workspace, and sandbox checks.

**Providers resolve; the seam starts.** A provider turns `resolveLaunch`/`resolveAttach` into a plan and never spawns or reads files. `DebugEnvironment` carries the composed `SubprocessRuntime` and `FileSystem`, which makes local, SSH, and sandbox one code path. The adapter must already exist in the target world — no host binary is copied to a remote or confined world — and a world that cannot grant the required capability fails before launch with `DEBUG_SANDBOX_DENIED` or `DEBUG_ATTACH_UNSUPPORTED` instead of degrading to a weaker transport.

**Ownership is per Session.** Every launch or attach carries the initiating Session; workspace archive admission reports and terminates sessions through the Workspace registry. A session-less debug launch has no reporting path and is refused.

**Control authority is per session, not per workspace.** Controlling a session another actor created requires an explicit grant: the per-session workbench toggle or a single approval for that call. `evaluate`, `setVariable`, `setExpression`, and `writeMemory` stay unreachable by a manipulated Agent against a process a person is debugging, and every control operation writes a durable `debug/control` event with its authorization source. Listing and reading session state stays workspace-wide; execution authority does not.

**Model-visible facts stay reconstructable.** Four durable events (`debug/session-started`, `debug/stopped`, `debug/session-ended`, `debug/control`) carry ids, provider, mode, relative source position, reason, outcome, and actor — nothing else. Variable values, memory, environment values, raw frames, and console text are not model-visible and are not logged. Transient DAP handles convert to branded ids at the `dsh-debug-dap` boundary and are never valid on replay.

**Surfaces render, they do not debug.** Web, Desktop, and CLI consume the same normalized state, capability bits, and error codes; they implement no DAP, no provider selection, and no launch-argument parsing. Editor save reuses `ctx.fs` versioned writes (`FS_STALE_VERSION` as the conflict), so one guarded-write implementation exists to audit.

**Adapter sources are `archive` or `pypi`, pinned and verified.** js-debug ships as a GitHub release archive with the official digest; debugpy installs into an isolated venv from PyPI with digest verification and rollback on self-test failure. Checksum verification, protocol constants, and the sandbox non-bypass rule are fixed invariants outside `Config`; deployment-varying limits and timeouts are validated `Config` fields. User command overrides skip managed install explicitly.

**Composition is opt-in for v1.** `@deepseek-ai/dsh-debug-bundle` is an `OPTIONAL_BUNDLES` member: enabled through `dsh plugin`, selected by no shipped template, and not in `dsh-base`.

## Compatibility

The durable debug events are same-version additions carrying `ignorable: true`; readers without the plugin skip them with no `SESSION_FORMAT_VERSION` bump. Debug sessions are not resumable across Host restart — the session owns a live adapter process and confined process tree, both process-local. Breakpoints, watch expressions, and named launch configurations persist across restarts; sessions terminate with their Host.

## Alternatives considered

**Host or embed an external IDE.** Rejected: the requirement is a shared session between a person and an Agent inside Harness; an external debugger holds state Harness cannot project.

**Per-language native protocols (CDP, debugpy wire, Delve RPC, LLDB API).** Rejected: four state machines and a new cost per language, for no capability DAP does not already expose.

**Workspace-wide Agent control after one approval.** Rejected for the blast radius: revisit only with a product decision that accepts code execution in a human's target process.

**Resume a debug session across Host restart.** Rejected: process-local resources cannot be rebuilt from the log; persistence is limited to breakpoints, watch expressions, and named configurations.

**A dedicated `api/workspace-edit` package for editor saves.** Rejected: `ctx.fs` already owns versioned atomic writes; a second write path duplicates the guard that prevents editor saves from clobbering concurrent changes.

**Recording debug state in the Session log for replay.** Rejected: it would put target-process memory and secrets into durable, model-visible history for no reconstruction benefit.

**An `npm` adapter source kind.** Removed during implementation: js-debug's DAP server ships as a GitHub archive, not an npm package, and no consumer needed npm; the model converged to `archive` plus `pypi`, with system-installed adapters carried by explicit user overrides rather than the managed manifest.

## Consequences

The fake DAP adapter stays authoritative for state-machine paths, with the real-adapter matrix keeping it honest per language and world. On machines without `go`/`dlv`/`lldb-dap`, those e2e lanes skip explicitly with the missing toolchain named rather than mocking the protocol path. The per-session serial queue documents two exceptions — unsettled resume/step waits do not hold the queue head, and adapter reverse requests process outside it — and both carry explicit tests. New-session cost is dominated by adapter install on first use; pre-warming the cache is the documented remedy for CI.
