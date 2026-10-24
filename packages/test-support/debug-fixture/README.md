---
description: "Typed fixture factories for debug-seam tests: deterministic branded session ids in the debug-<16 hex> format and Debug* value builders, for maintainers writing or reviewing debug tests."
kind: "package-library"
---

# @deepseek-ai/dsh-debug-fixture

English | [中文](README.zh.md)

## Summary

Use `dsh-debug-fixture` to construct every `Debug*` test value through typed factories instead of `as never` or `as unknown` casts. Factories brand ids and mint the seam's `debug-` + 16 lowercase hex digits session-id format deterministically from a numeric seed, so failing tests name stable, well-formed ids. A missing factory shape is a contract gap to raise first; adding a cast is not an option. This package is test support only: it registers nothing and mounts into no product composition.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import the factory for the value under test and pass a small stable seed. `fixtureDebugSessionId(1)` yields `debug-0000000000000001` as a branded `DebugSessionId`. Seeds must be non-negative safe integers; anything else throws `RangeError` at construction so a broken seed fails the test that owns it.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Factory coverage grows with the seam's consumers: stop snapshots, stack frames, threads, compound children, and session headers arrive with the tasks that pin their behavior.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
