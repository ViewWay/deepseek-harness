---
description: "Workbench layout, panel registry, and shared file tree and terminal surfaces composing the debug workbench."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

## Summary

The workbench package owns the Web/Desktop debug workbench's layout: the panel registry, the dock arrangement over `ui-dockkit`, the shared file tree and terminal surfaces, responsive behavior, and focus routing between the editor and the debug panels.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Use this package

Consume the browser export through the client plugin loader. The package registers its copy namespace and panel contributions; it projects already-logged debug events and never assembles a model request.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

## Model Experience

None, as the package is a browser-only workbench layout and panel registry that projects already-logged events and assembles no model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The persisted layout stores open panel ids and dock locations only; dock sizing and float positions are session-local and reset on reload.
- The workbench never moves focus itself: `focusOnStop` records the policy for the embedder's own focus routing, and screen-reader announcements go through a live region.
- A panel id the restored layout names but the registry no longer lists is ignored by the renderer rather than an error.
