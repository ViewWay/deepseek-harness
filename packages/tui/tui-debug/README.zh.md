---
description: "面向 TUI 的终端调试面板、命令、源码预览与 $EDITOR 跳转，直接驱动进程内 ctx.debug 缝。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tui-debug

[English](README.md) | 中文

## Summary

面向 TUI 的终端调试面板、`:debug` 命令族、源码预览与 `$EDITOR` 跳转。本包直接
驱动进程内 `ctx.debug` 缝——不经 Remote 层——并将 run-in-terminal 请求复用
`ctx.terminals`，使 TUI 运行时保持零 PTY 依赖。

为并行任务开发预登记的骨架条目；Task 23 填充面板、命令与编辑器跳转。

## Use this package

经 `tui` profile 加载插件（`tui-app` bundle 已声明依赖）。它注册作用于已记录
调试事件的终端侧呈现与命令，不组装任何模型请求。
