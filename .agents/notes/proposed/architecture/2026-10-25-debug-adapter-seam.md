# Agent Note: Debug adapter seam — DAP, execution worlds, and per-session control

Status: proposed

English | [中文](2026-10-25-debug-adapter-seam.zh.md)

Scope: this note owns the durable rationale and the boundary decisions for IDE-level debugging in Harness. The exhaustive type inventory, panel list, and task breakdown live in the design and implementation working documents, which are not repository references; the guarantees below are stated completely enough that the note stays correct without them. Related standing contracts: [architecture](../../../../docs/architecture.md), [testing policy](../../../../docs/testing.md), [capability seams](../../../../docs/capability-seams.md).

## Problem

Harness has no debugger for user programs. `packages/experimental/inspector` drives CDP against Harness itself, and no client surface can hold a stopped process, its call stack, and its variables while an Agent keeps working the same problem.

The capability has to satisfy four demands at once, and each one pulls against a standing Harness rule:

- One session, two controllers. A person clicking a breakpoint and an Agent calling a tool must observe identical state, so neither can own a private copy of the debugger.
- Four languages and three execution worlds. Node/TypeScript, Python, Go, and Rust/C/C++ have no common debugger API beyond DAP, and the same session must work against local, SSH, and sandbox execution providers.
- A debugger executes arbitrary code in another process. `evaluate`, `setVariable`, and `setExpression` run expressions inside the target; `readMemory` and `source` read what that process already holds.
- Adapters are third-party binaries with platform-specific licenses, checksums, and OS privileges (ptrace, `task_for_pid`).

## Proposal

**One seam, DAP stays in one package.** `ctx.debug` is the Service Definition; language providers, `dsh-tool-debug`, and the Web/Desktop/TUI clients are separate roles. DAP framing, handshake, capability projection, and reverse requests exist only in `dsh-debug-dap`, and the normalized model never carries a raw DAP request or response. That is a negative guarantee: no escape hatch reaches the protocol, so permission, workspace, and sandbox checks cannot be stepped around by a caller who knows DAP.

**Providers resolve; the seam starts.** A provider implements `resolveLaunch`/`resolveAttach` into a plan and never spawns or reads files: it receives `DebugEnvironment` carrying the composed `SubprocessRuntime` and `FileSystem`. Following the existing execution providers is what makes local, SSH, and sandbox one code path rather than three. Two consequences are deliberate and stay fixed: the adapter must already exist in the target world (no host binary is copied to a remote or confined world), and a world that cannot grant `ptrace` or `networkListen` fails before launch with `DEBUG_SANDBOX_DENIED` or `DEBUG_ATTACH_UNSUPPORTED` instead of silently degrading to a weaker transport.

**Ownership is per Session, so cleanup has an owner.** Every `launch`/`attach` carries the initiating Session — an Agent's own Session, or the conversation Session the workbench is running in. Workspace archive admission is keyed by Session (`workspace/session-activity` reports, `workspace/session-stop` terminates, alongside the existing `turn`, `job`, `subagent`, and `schedule` families); a session-less debug launch has no reporting path and would survive until Host shutdown, so the seam refuses it.

**Control authority is per session, not per workspace.** The reviewed alternative — an Agent may control every session in its workspace once one launch is approved — was rejected. Control of a session another actor created requires an explicit grant: the per-session workbench toggle or a single approval for that call. `evaluate`, `setVariable`, `setExpression`, and `writeMemory` therefore cannot be reached by a manipulated Agent against a process a person is debugging, and every control writes `debug/control`. Listing and reading session state stays workspace-wide; execution authority does not.

**The tool face launches through the orchestrator seam, approval-gated.** `dsh-tool-debug` owns the gate: it validates the launch/attach fields first (an invalid request never asks), passes agent callers through `ctx.approval` fail-closed — `DEBUG_APPROVAL_DENIED`, with the detail separating an active rejection from a missing answerer — authorizes control of the session the caller will own (`owned` when the caller owns what it created, agent or user; `session-grant`; `single-approval`), then delegates to `ctx.debug.launch`/`attach` and appends the `debug/control` audit on the calling session's log. The durable payload stays the pinned five-field `DebugControlEvent` contract (session, actor, operation, thread/frame; `docs/persistence-changes/2026-10-25-debug-events.md`), so the grant source rides the tool result instead of the event. Agent memory writes ask on every call; UI-originated launches confirm in the UI and never enter the agent approval seam. Stop notices landed with their Config home on the tool package (`debugStopDelivery`, `debugMaxConsecutiveWakes`, `maxNoticeBytes` — deliberately not the job package's same-named fields), and the notice suppresses the stop the receiving session's own unsettled resume settles, because that resume's result already delivers it.

**Model-visible facts stay reconstructable.** Four durable events (`debug/session-started`, `debug/stopped`, `debug/session-ended`, `debug/control`) carry ids, provider, mode, relative source, line/column, reason, outcome, and actor. Variable values, memory, environment values, raw DAP frames, and console text are not model-visible, so they are not logged. Each event is `ignorable: true`, which is what lets readers without the plugin skip it without a `SESSION_FORMAT_VERSION` bump. Transient handles (`frameId`, `variablesReference`, adapter breakpoint ids) appear in the log only as audit values and are never valid on replay; DAP numbers convert to branded ids at the `dsh-debug-dap` boundary and nowhere else.

**Surfaces render, they do not debug.** Web, Desktop, and CLI consume the same normalized state, capability bits, and error codes; they differ only in rendering, input, adapter source, and notification channel. Clients implement no DAP, no provider selection, and no launch-argument parsing. Editor save reuses `ctx.fs` versioned writes (`writeText` with `replaceIfVersion`, `FS_STALE_VERSION` as the conflict) instead of a second write path, so there is one guarded-write implementation to audit.

**Adapters are pinned, verified, and installed in the target world.** A repository manifest fixes version, per-platform archive, SHA-256, license, and executable path; installation is never silent, runs a handshake self-test, and refuses to update or uninstall mid-session. User overrides of command and path are explicit and skip managed install. Checksum verification, the DAP protocol constants, and the sandbox non-bypass rule are fixed invariants and stay out of `Config`; every deployment-varying limit and timeout is a validated `Config` field.

**One session-operation contract, dispatched end to end.** The tool dispatch, the debug-controller remotes, and tests consume one `DebugSessionOperations` contract, resolved per session through the `ctx.debug` backend registry, never per-layer method subsets. Consequences that stay fixed: `memoryReference` anchors flow from `variables`, `evaluate`, and `disassemble` results into `read_memory`, `write_memory`, and `disassemble` without a second lookup face; a memory read carries the adapter-resolved address and unreadable tail, and a memory write surfaces the adapter's partial-write report; `breakpoint_locations` completes the inspection vocabulary with the adapter-resolved legal positions of a source range. Capability gating differentiates per provider in practice, not only in type — of the measured adapter set (upstream capability declarations, 2026-10: bundled vscode-js-debug 1.140.0, debugpy main pydevd dispatcher, delve master DAP server, lldb-dap main), `setVariable` is universal, `restartFrame` is vscode-js-debug only, debugpy lacks memory read/write, and delve lacks completions:

| Operation | vscode-js-debug | debugpy | delve (DAP) | lldb-dap |
| --- | --- | --- | --- | --- |
| setVariable | ✓ | ✓ | ✓ | ✓ |
| restartFrame | ✓ | ✗ | ✗ (never planned) | ✗ |
| readMemory/writeMemory | ✓ | ✗ | ✓ | ✓ |
| completions | ✓ | ✓ | ✗ | ✓ |
| breakpointLocations | ✓ (root handler may return []) | ✗ | ✗ | unverified |

The `capabilities/changed` emitter exists at the backend level — fired post-handshake and on DAP capabilities events; wiring it into the domain event waits on the session-face composition (the next wave), so no UI gating is live in production yet.

## Alternatives considered

- **Host or embed an external IDE.** Rejected: the requirement is a shared session between a person and an Agent inside Harness, and an external debugger holds state Harness cannot project.
- **Per-language native protocols (CDP, debugpy wire, Delve RPC, LLDB API).** Rejected: four state machines and a new cost per added language, for no capability DAP does not already expose.
- **Workspace-wide Agent control after one approval.** Rejected for the blast radius described above; revisit only with a product decision that accepts code execution in a human's target process.
- **Resume a debug session across Host restart.** Rejected: the session owns a live adapter process and confined process tree, which are process-local resources. Breakpoints, watch expressions, and named configurations persist; sessions do not.
- **A dedicated `api/workspace-edit` package.** Rejected after review: `ctx.fs` already owns versioned atomic writes and `fs/observed`, and a second write path duplicates the guard that keeps editor saves from clobbering concurrent changes.
- **Recording debug state in the Session log for replay.** Rejected: it would put target-process memory and secrets into durable, model-visible history for no reconstruction benefit.

## Acceptance criteria

- One keyless recorded-session snapshot per surface proves the same stop, step, and terminate sequence produces identical normalized state and error codes on Web, Desktop, and CLI.
- A human-started session refuses Agent control until granted, and the grant path and the refusal path both assert the `debug/control` authorization source.
- Archiving a Session that owns a running debug session reports it and terminates it; the assertion runs through the Workspace registry, not a direct call.
- A confined or remote world without the required capability fails before launch with the specific code, and no host adapter binary is copied into it.
- Adapter installation rejects a checksum mismatch, leaves no partial directory, and keeps verification non-configurable.
- The durable event set carries no variable value, memory byte, or environment value; a test asserts their absence in the committed JSONL and in `headless --json` output.
- Provider tasks add no `unknown` or `as never` to the seam types; a shape gap changes the contract first.

## Risks

- DAP standardizes the protocol, not launch configuration, so provider schemas and the platform matrix carry the divergence; keep real-adapter e2e per language rather than trusting the fake adapter.
- Sandbox ptrace and macOS `task_for_pid` make attach availability platform-specific; report the missing capability before launch instead of surfacing a protocol error.
- SSH worlds may be unable to download an adapter, which the no-host-fallback rule turns into a hard failure with installation guidance.
- Per-session serialization plus adapters that issue reverse requests during `launch` risks deadlock; the two documented exceptions (unsettled resume waits and adapter-initiated reverse requests) need explicit coverage.
- Ink, ink-testing-library, and node-pty are new native-facing test dependencies and `ctx.terminals` already provides persistent terminals; resolve that overlap in dependency review before the TUI task starts.
- Per-file 100% coverage across roughly sixteen new packages plus a four-language, three-world, three-surface matrix is the dominant CI cost; keep the fake adapter authoritative for state machine paths so the real matrix stays narrow.
