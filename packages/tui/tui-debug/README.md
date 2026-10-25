---
description: "Terminal debug panels, commands, source preview, and the $EDITOR handoff over the in-process ctx.debug seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-tui-debug

English | [中文](README.zh.md)

## Summary

Terminal debug panels, the `:debug` command family, source preview, and the
`$EDITOR` handoff for the TUI. The package drives the in-process `ctx.debug`
seam directly — no Remote layer — and reuses `ctx.terminals` for
run-in-terminal requests, keeping the TUI runtime free of any PTY dependency.

Skeleton entry pre-registered for parallel task development; Task 23 fills the
panels, commands, and editor handoff.

## Use this package

Load the plugin through the `tui` profile (the `tui-app` bundle declares the
dependency). It registers terminal-side presentation and commands over
already-logged debug events and assembles no model request.
