---
description: "Workbench layout, panel registry, and shared file tree and terminal surfaces composing the debug workbench."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

## Summary

The workbench package owns the Web/Desktop debug workbench's layout: the panel registry, the dock arrangement over `ui-dockkit`, the shared file tree and terminal surfaces, responsive behavior, and focus routing between the editor and the debug panels. Its client plugin provides the panel registry as `ctx.workbenchPanels`, registers the debug view summary panel into it, and provides the toolbar wiring as `ctx.workbenchDebug` — one external store the page host forwards into `Workbench` as the `debug` props bundle.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Use this package

Consume the browser export through the client plugin loader. The plugin registers the `workbench` copy namespace, provides the panel registry with the `debug.view` panel (the debug view service's live session states, stop location, and notices, copy through the `debug` namespace), and builds the toolbar controls bundle over the debug view service: the store state and selection gestures, the notification setting and actor indicator it owns (no Remote carries either yet), and `onAction` addressed to the selected session. It projects already-logged debug events and never assembles a model request.

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
- The page host that embeds `Workbench` with the shared file tree, editor, and terminal nodes is not composed yet; `ctx.workbenchDebug.controls` is the bundle it forwards, and the notification setting and actor indicator hold their defaults until a Remote carries them.
- The workbench never moves focus itself: `focusOnStop` records the policy for the embedder's own focus routing, and screen-reader announcements go through a live region.
- A panel id the restored layout names but the registry no longer lists is ignored by the renderer rather than an error.
