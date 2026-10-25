---
description: "Workbench layout, panel registry, and shared file tree and terminal surfaces composing the debug workbench."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

## Summary

The workbench package owns the Web/Desktop debug workbench's layout: the panel
registry, the dock arrangement over `ui-dockkit`, the shared file tree and
terminal surfaces, responsive behavior, and focus routing between the editor
and the debug panels.

Skeleton entry pre-registered for parallel task development; Task 20 fills the
panel registry, layout, and focus behavior.

## Use this package

Consume the browser export through the client plugin loader. The package
registers its copy namespace and panel contributions; it projects
already-logged debug events and never assembles a model request.
