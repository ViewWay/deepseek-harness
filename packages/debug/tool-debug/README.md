---
description: "Model-facing debug tools over ctx.debug: four registered tools with closed operation unions, bounded canonical results, a fixed system-prompt section, and pure renderers, for maintainers composing agent debugging."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-debug

English | [中文](README.zh.md)

## Summary

Use `dsh-tool-debug` to expose the debug seam to the model. The plugin registers four tools — `debug_session`, `debug_execution`, `debug_inspect`, `debug_breakpoints` — each with a closed operation union rejecting unknown operations (`DEBUG_UNKNOWN_OPERATION`). Session list/get/terminate/disconnect and workspace-scoped file breakpoint replacement run against `ctx.debug`; execution and inspection dispatch onto the session's registered backend, failing typed `DEBUG_UNAVAILABLE` without one. Launch and attach are approval-gated and delegate to the orchestrator seam; memory writes ask per call; stop notices reach the owning session via Config. The system-prompt section positions them: runtime-state failures only, breakpoints before launch, minimal evaluation, terminate before finishing, and file/LSP tools for navigation.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin after `dsh-debug`. Tools validate the operation union first, then the session id and operation-specific fields; domain failures surface as `DebugError` codes the model can read. Launch and attach need `providerId`, `workspaceId`, `workspaceRoot`, and `cwd` (launch): agent calls pass `ctx.approval` fail-closed, the calling session owns the new debug session, and the durable `debug/control` audit lands on that session's log; UI-originated launches confirm in the UI and bypass the agent approval seam. Execution and inspection resolve the session's backend through the `ctx.debug` backend registry, so the composition must register one per live session. Reference arguments (`threadId`, `frameId`, `variablesReference`, `sourceReference`) are the seam's serialized string ids echoed verbatim from earlier results, and `memoryReference` anchors pass from `variables`, `evaluate`, and `disassemble` results into `read_memory`, `write_memory`, and `disassemble`. Breakpoint operations take an explicit `workspaceId`; without `sessionId` they act on the persisted workspace set and apply to every matching live session, with `sessionId` they scope to one session (typed-unavailable until the session face lands). Rendering relativizes stack sources to workspace paths, caps values with preserved child references, and keeps `truncated`/`total` on every bounded view. Stop notices flow under the plugin Config: `debugStopDelivery` (wake or quiet), `debugMaxConsecutiveWakes`, and `maxNoticeBytes`.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One system-prompt section (registered after the LSP tool section) positions the four debug tools with the following text:

##### Verbatim guidance

```markdown
Use the debug tools when a failure depends on runtime state that reading code and tests cannot explain. Set breakpoints before launching; after a stop, inspect threads, the stack, and scopes before stepping or continuing. Evaluate only the minimal necessary expressions; memory writes need an explicit justification and approval. Terminate every debug session you started before finishing; do not leave background debug processes running. Use file and language-server tools for ordinary code navigation; do not substitute the debugger for search.
```

#### Token effect

Fixed guidance cost on every request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged; activation or disposal may invalidate reuse from this section.

### Tool schemas

#### What the model sees

Four tool schemas, each carrying a closed `operation` enum with the exact vocabulary of its union: `debug_session` (launch, attach, launch_compound, list, list_compounds, get, get_compound, terminate, terminate_compound, disconnect, attach_targets), `debug_execution` (continue, pause, step_over, step_in, step_out, step_back, restart, restart_frame, wait_for_stop), `debug_inspect` (threads, stack_trace, scopes, variables, evaluate, set_variable, set_expression, completions, exception_info, modules, loaded_sources, source, disassemble, read_memory, write_memory, breakpoint_locations, console), `debug_breakpoints` (set_file, set_function, set_exception, set_data, set_instruction, list, clear). The model sees the generated [debug tool schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-debug).

#### Token effect

Fixed schema cost on every request while enabled; the four enums enumerate every operation name once each.

#### KV Cache effect

Prefix-stable while the visible tool definitions and order are unchanged; registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

Bounded canonical JSON: session listings and infos as plain records, stack traces with workspace-relative sources and frame caps (`truncated`/`total` on every bounded view), variables with per-value caps that preserve child `variablesReference` for lazy expansion. Resume operations return the settlement — `kind` stopped with the workspace-relative stop location, terminated, or running. Launch and attach return the session record with the control grant's source (`grantedBy`). Memory reads return base64 `data` with the resolved `address` and the `unreadableBytes` tail; memory writes return the adapter's `offset`/`bytesWritten` report when it reports one; `breakpoint_locations` returns the adapter-resolved positions sorted by line and column. Domain failures surface as `DebugError` codes (`DEBUG_UNKNOWN_OPERATION`, `DEBUG_SESSION_GONE`, `DEBUG_UNAVAILABLE`, `DEBUG_INVALID_CONFIG`, `DEBUG_APPROVAL_DENIED`, `DEBUG_CONTROL_NOT_GRANTED`, `DEBUG_BREAKPOINT_LIMIT`) the model can route on without parsing message text.

#### Token effect

Capped per view by the rendering bounds (frame cap, value cap); breakpoint application results enumerate applied and rejected sides.

#### KV Cache effect

Tool results append after the cached request prefix and do not directly invalidate it.

### UI presentation

#### What the model sees

Nothing. The client renders a generic card from the raw tool result; no debug-specific presenter ships in this task.

#### Token effect

Zero direct token effect because rendering is client-side only.

#### KV Cache effect

None; UI presentation is outside the model request.

## Known Limitations and Deferred Work

- Launch and attach are approval-gated and delegate to the installed orchestrator; a composition without one fails closed `DEBUG_UNAVAILABLE`, and agent calls additionally need an approval answerer. `wait_for_stop` fails the same way until its stop-event face lands.
- Execution and inspection dispatch over the session's registered backend; operations the adapter lacks the capability for fail `DEBUG_UNSUPPORTED_CAPABILITY` at the backend, so per-provider coverage varies with the adapter.
- Variables, modules, and console paging options are not exposed; those operations read the backend's default page.
- Compound operations, attach-target probing, function/exception/data/instruction breakpoints, and the persisted-set listing read face land with their backing services.
