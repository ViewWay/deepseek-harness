---
description: "The Rust/C/C++ debug provider registering on ctx.debug: launch and attach resolution into the frozen plan shapes for lldb-dap, with the verified LLVM 23.1.4 archive manifest digests, for maintainers composing native debugging."
kind: "package-reference"
---

# @deepseek-ai/dsh-debug-native

English | [中文](README.zh.md)

## Summary

Use `dsh-debug-native` to give a composition Rust, C, and C++ debugging. The plugin registers one provider on `ctx.debug` (rs/c/cpp/h family extensions) and, when `ctx.debugAdapters` is composed, the verified LLVM 23.1.4 manifest. `resolveLaunch` requires a program binary path and turns the request into the frozen `DebugLaunchPlan` — adapter command, DAP launch request, the target binary, and the `ptrace` execution capability. `resolveAttach` accepts exactly one of process id (DAP `pid`) or lldb-server port (translated to `attachCommands`). No provider launch options are modeled; unknown ones fail loud.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin after `dsh-debug` (required) and optionally `dsh-debug-adapter-manager`. The manifest pins LLVM 23.1.4 per platform with GitHub-published SHA-256 digests; each entry is a full toolchain archive (0.9–2.0 GB, sizes shown at install time), and macOS Intel has no LLVM release binary — system installs (Xcode, distro packages) ride user overrides. Disposal releases the provider and manifest together.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The archives' interior layout (`bin/lldb-dap`) follows the upstream release documentation; this environment could not download the archives to list them, so it stays pending real e2e verification in the adapter-matrix task, where the missing local lldb-dap also skips real launches with a recorded reason.
- Custom LLDB init scripts, `sourceMap` remaps, and core-dump targets are not modeled.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
