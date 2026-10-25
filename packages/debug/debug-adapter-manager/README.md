---
description: "The managed debug-adapter service (ctx.debugAdapters): validated adapter manifests with per-platform SHA-256 records, checksum-verified install with self-test rollback, concurrent-install sharing, and override-free resolution for the target execution world, for maintainers composing managed debugging."
kind: "package-reference"
---

# @deepseek-ai/dsh-debug-adapter-manager

English | [中文](README.zh.md)

## Summary

Use `dsh-debug-adapter-manager` to own `ctx.debugAdapters`: it validates and registers adapter manifests (pinned versions, per-platform download records with SHA-256 digests, licenses, and required execution capabilities), installs adapters into a target execution world with mandatory checksum verification and a handshake self-test that rolls the whole install back on failure, shares one in-flight install per provider and platform, and resolves installed adapters without ever falling back to a host adapter for a remote world. Unpublished platforms stay absent — resolution rejects them with `DEBUG_ADAPTER_UNSUPPORTED` instead of emulating compatibility. The manager never approves anything: callers complete user confirmation first.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this service where managed adapters apply. Register each provider's manifest data as read from its repo file; registration validates everything and its disposer releases the record. Install with the target world's I/O (`fetchBytes`, `write`, `remove`, `exists`, `runSelfTest`) and that world's install root — the installer writes `<root>/<provider>/<version>/<platform>/`, verifies the archive digest before writing, and deletes the directory when the checksum or the self-test fails. `resolve` returns the adapter command for the target world only when the executable exists there; an absent install fails with `DEBUG_ADAPTER_NOT_FOUND` rather than substituting the host's copy.

Failures are typed: `DEBUG_INVALID_CONFIG` for malformed manifests (including `latest` versions and unknown fields), `DEBUG_ADAPTER_CHECKSUM` for malformed digests and download mismatches, `DEBUG_ADAPTER_UNSUPPORTED` for unpublished platforms, system sources under managed install, and failing self-tests, and `DEBUG_ADAPTER_NOT_FOUND` for unregistered providers or absent installs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- **Data boundary validation.** Manifests are repo data crossing a file boundary: `parseAdapterManifest` validates every field element by element, building typed values without casts; the only branded conversion happens at the validated provider id.
- **World-scoped I/O.** The installer and resolver take an explicit `DebugAdapterInstallEnvironment`; they never touch host Node APIs, so local, SSH, and sandbox worlds install through their own bridges.
- **Commit-then-publish.** Install lifecycle events (`adapter/installed`, `adapter/uninstalled`, `adapter/install-failed`) publish only after the operation settles; listener failures are contained.
- **Shared in-flight operations.** Concurrent installs of the same provider and platform share one promise, so a double click downloads once.

### Source map

| File | Role |
|---|---|
| [`src/manifest.ts`](src/manifest.ts) | Manifest validation, platform keys, and unpublished-platform rejection |
| [`src/install.ts`](src/install.ts) | Checksum-verified install with self-test rollback and install-layout resolution |
| [`src/manager.ts`](src/manager.ts) | `ctx.debugAdapters`: registry, shared installs, resolution, and lifecycle events |

</details>

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The bridge from a full `DebugEnvironment` (subprocess and fs services) to the install environment lands with the execution-world tasks; this package defines and consumes the narrow I/O face.
- Archive extraction beyond the checksum-verified single-file write and install-progress cancellation land with the adapter-matrix tasks; archive self-tests run `<executable> --version` and pypi installs import-test the package inside the venv.
- Wheel selection reads the default PyPI index; deployment index overrides land with the adapter-matrix tasks.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
