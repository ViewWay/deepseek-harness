# Debug sessions in the Web and Desktop workbench

English | [中文](debugging.zh.md)

## Summary

Enable the [debug bundle](../../../packages/bundle/debug/README.md) to give your sessions IDE-level debugging: launch or attach to a program in Node.js/TypeScript, Python, Go, or Rust/C/C++, then control execution and inspect state from the workbench while the agent works in the same session. The bundle is optional and off by default; the plugin manager enables it per profile.

## Table of Contents

- [Enable the bundle](#enable-the-bundle)
- [Set up an adapter](#adapter-setup)
- [Start a debug session](#start-a-session)
- [Work the panels](#work-the-panels)
- [Edit files while debugging](#editing-and-save-conflicts)
- [When something fails](#common-failures)
- [Further Exploration](#further-exploration)

<a id="enable-the-bundle"></a>
## Enable the bundle

Open the Plugins page from the sidebar, find **Debugger**, and switch it on. The bundle stacks the debug seam, the four language providers, the agent debug tools, and the workbench panels over your current profile; disabling it removes all of them together. The agent's `debug_session`, `debug_execution`, `debug_inspect`, and `debug_breakpoints` tools appear in sessions created after the bundle starts.

<a id="adapter-setup"></a>
## Set up an adapter

You do not install adapters by hand. The first launch in a language resolves its adapter — the js-debug DAP server for Node, debugpy for Python, Delve for Go, lldb-dap for Rust/C/C++ — verifies its published SHA-256, and installs it into a managed location. The adapter settings panel shows each adapter's version, platform, license, digest, and install state, with install, update, uninstall, and self-test actions.

If your machine already has the toolchain you prefer (a system lldb-dap, a specific debugpy), point the provider at it through the adapter settings override path; the manager then uses your command as-is and skips the download.

Language prerequisites are the toolchains themselves: debugging Go needs `go` and a Delve-compatible toolchain, and native debugging needs the lldb-dap binary plus, on Linux, ptrace permission or on macOS, developer-mode approval for task_for_pid.

<a id="start-a-session"></a>
## Start a debug session

Either ask the agent — "launch src/server.ts with the node provider and stop on entry" — or open the workbench and configure the launch yourself: pick the provider, the program or module, the working directory, and any arguments. Launch and attach always carry the current conversation's identity, so the session appears in the workbench and the agent's tool results describe the same run.

Attach works three ways: by process id, by debug port, or (for Node) by URL. The provider probes eligible targets where the language supports it; an SSH or sandboxed target attaches in its own execution world and never falls back to a host-local adapter.

While a session runs, launching, attaching, and memory writes go through the normal approval flow. A request you or the deployment cannot answer fails closed with `DEBUG_APPROVAL_DENIED` — nothing starts silently.

<a id="work-the-panels"></a>
## Work the panels

The toolbar carries the run controls, session and thread selectors, and the agent-stop notification toggle. Controls appear only when the adapter reported the capability, so a panel or button that is absent means the adapter does not support it.

- **Stack and threads** — pick a thread, then a frame; the editor follows the selected frame's source location.
- **Variables and watch** — variables load one level at a time; expand a node to see more. Watch expressions re-evaluate per stop, and one failing watch shows its own error without affecting the others.
- **Breakpoints** — set them in the editor gutter or the breakpoints panel; they persist across sessions through the breakpoint store, and the panel shows which ones the adapter verified.
- **Console** — the bounded output ring of the debuggee; pages load on demand.
- **Modules, loaded sources, disassembly, memory** — capability-gated panels; memory read and write require the adapter to declare support, and memory write asks for approval every time.

Stopping the agent does not stop your debug session; they are separate owners. You can take over a session the agent started, and it records the takeover in the audit trail.

<a id="editing-and-save-conflicts"></a>
## Edit files while debugging

The workbench editor writes through the host filesystem's version guard. If the file changed on disk since you opened it, the save is refused with a stale-version conflict instead of overwriting; reload the file and reapply your edit. Creating a file refuses to clobber one that appeared meanwhile. There is no silent merge.

<a id="common-failures"></a>
## When something fails

- **`DEBUG_APPROVAL_DENIED`** — no approval answerer was composed, or the request was rejected. Check who was asked and answer the prompt, or enable the bundle in a profile that composes the approval dialog.
- **`DEBUG_ADAPTER_NOT_FOUND` / `DEBUG_ADAPTER_CHECKSUM`** — the adapter is not installed yet or failed verification; retry the install from the adapter settings panel, or override the command with your own toolchain.
- **`DEBUG_ATTACH_UNSUPPORTED`** — the target world cannot serve this attach (for example a tunnel that cannot open); attach locally or fix the forwarding.
- **`DEBUG_WORKSPACE_MISMATCH`** — the session belongs to another workspace; switch workspaces rather than crossing the boundary.
- **`DEBUG_TIMEOUT`** — the adapter missed its handshake deadline; check the adapter runs at all in the target world, then retry.
- **`DEBUG_SESSION_GONE`** — the session ended; the panels show the last stop as stale until you start or select a live session.

<a id="further-exploration"></a>
## Further Exploration

- [The debug subsystem contract](../../subsystems/debug.md)
- [Debugging in the terminal and headless](./debugging-cli.md)
- [The debug composition bundle](../../../packages/bundle/debug/README.md)
