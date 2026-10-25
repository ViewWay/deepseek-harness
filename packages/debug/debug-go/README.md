---
description: "The Go debug provider registering on ctx.debug: launch and attach resolution into the frozen plan shapes for delve, with the verified v1.27.2 per-platform manifest digests, for maintainers composing Go debugging."
kind: "package-reference"
---

# @deepseek-ai/dsh-debug-go

English | [中文](README.zh.md)

## Summary

Use `dsh-debug-go` to give a composition Go debugging. The plugin registers one provider on `ctx.debug` (`.go` extensions) and, when `ctx.debugAdapters` is composed, the verified delve manifest. `resolveLaunch` turns a request into the frozen `DebugLaunchPlan` — adapter command, DAP `go` launch request (program or package, delve `mode`, `buildFlags`, `dlvFlags`), the delve process as target, and the `go` execution capability. `resolveAttach` accepts exactly one of process id or delve headless port. Unknown options and modes fail loud.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin after `dsh-debug` (required) and optionally `dsh-debug-adapter-manager`. The manifest pins delve v1.27.2 with the GitHub-published SHA-256 digest for each platform archive; the same release also ships a PGP-signed checksums file. Disposal releases the provider and manifest together.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The archives' interior layout (`dlv` / `dlv.exe` at the archive root) follows the upstream release documentation; this environment could not download the archives to list them, so it stays pending real e2e verification in the adapter-matrix task, where the missing local Go toolchain also skips real launches with a recorded reason.
- Delve's `core` dump mode, `--only-same-user` tunables, and remote (`remote` mode) attach routing are not modeled.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
