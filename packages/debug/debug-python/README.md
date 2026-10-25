---
description: "The Python debug provider registering on ctx.debug: interpreter-validated launch and attach resolution into the frozen plan shapes with debugpy option whitelisting, for maintainers composing Python debugging."
kind: "package-reference"
---

# @deepseek-ai/dsh-debug-python

English | [中文](README.zh.md)

## Summary

Use `dsh-debug-python` to give a composition Python debugging. The plugin registers one provider on `ctx.debug` (`.py`/`.pyw` extensions). `resolveLaunch` turns a request into the frozen `DebugLaunchPlan` — adapter command, DAP `debugpy` launch request (program or module, the required `python` interpreter, and the mapped `justMyCode`/`subProcess`/`django`/`flask` options), the target as the interpreter running the entry, and the `python` execution capability. `resolveAttach` accepts exactly one of process id or debugpy listen port. Unknown options fail loud; the interpreter option is required.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin after `dsh-debug`. Requests validate with `DEBUG_INVALID_CONFIG` for entry exclusivity, a missing interpreter, or unknown provider options; adapter absence surfaces through the environment's adapter resolution.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The managed debugpy manifest is deferred until the venv-based install model lands (upstream verified in the meantime: debugpy 1.8.22, MIT, per-Python-version platform wheels with PyPI-published digests).
- `console`-style `internalConsole` routing, `pyramid`/`gevent` options, and attach-by-URL are not modeled.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
