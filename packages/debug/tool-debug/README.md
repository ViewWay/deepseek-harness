---
description: "Model-facing debug tools over ctx.debug: four registered tools with closed operation unions, bounded canonical results, a fixed system-prompt section, and pure renderers, for maintainers composing agent debugging."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-debug

English | [中文](README.zh.md)

## Summary

Use `dsh-tool-debug` to expose the debug seam to the model. The plugin registers four tools — `debug_session`, `debug_execution`, `debug_inspect`, `debug_breakpoints` — each with a closed operation union that rejects unknown operations with `DEBUG_UNKNOWN_OPERATION`. Landed service faces dispatch directly: session list/get/terminate/disconnect and workspace-scoped file breakpoint replacement (set_file/clear) run against `ctx.debug`; every operation whose backing session face arrives with the DAP backend fails typed `DEBUG_UNAVAILABLE` naming the arriving face. The fixed system-prompt section positions the tools: runtime-state failures only, breakpoints before launch, minimal evaluation, sessions terminated before finishing, and file/LSP tools for ordinary navigation.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin after `dsh-debug`. Tools validate the operation union first, then the session id and operation-specific fields; domain failures surface as `DebugError` codes the model can read. Breakpoint operations take an explicit `workspaceId`; without `sessionId` they act on the persisted workspace set and apply to every matching live session, with `sessionId` they scope to one session (typed-unavailable until the session face lands). Rendering relativizes stack sources to workspace paths, caps values with preserved child references, and keeps `truncated`/`total` on every bounded view.

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

Four tool schemas, each carrying a closed `operation` enum with the exact vocabulary of its union: `debug_session` (launch, attach, launch_compound, list, list_compounds, get, get_compound, terminate, terminate_compound, disconnect, attach_targets), `debug_execution` (continue, pause, step_over, step_in, step_out, step_back, restart, restart_frame, wait_for_stop), `debug_inspect` (threads, stack_trace, scopes, variables, evaluate, set_variable, set_expression, completions, exception_info, modules, loaded_sources, source, disassemble, read_memory, write_memory, console), `debug_breakpoints` (set_file, set_function, set_exception, set_data, set_instruction, list, clear). The model sees the generated [debug tool schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-debug).

#### Token effect

Fixed schema cost on every request while enabled; the four enums enumerate every operation name once each.

#### KV Cache effect

Prefix-stable while the visible tool definitions and order are unchanged; registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

Bounded canonical JSON: session listings and infos as plain records, stack traces with workspace-relative sources and frame caps (`truncated`/`total` on every bounded view), variables with per-value caps that preserve child `variablesReference` for lazy expansion. Domain failures surface as `DebugError` codes (`DEBUG_UNKNOWN_OPERATION`, `DEBUG_SESSION_GONE`, `DEBUG_UNAVAILABLE`, `DEBUG_INVALID_CONFIG`, `DEBUG_BREAKPOINT_LIMIT`) the model can route on without parsing message text.

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

- Launch and attach validate their fields, then fail `DEBUG_UNAVAILABLE` until the approval-wired orchestration lands (the approvals and audit task); execution and inspection operations fail the same way until the DAP session face is exposed on live sessions.
- Compound operations, attach-target probing, function/exception/data/instruction breakpoints, and the persisted-set listing read face land with their backing services.
