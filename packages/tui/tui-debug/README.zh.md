---
description: "面向 TUI 的终端调试面板、命令、源码预览与 $EDITOR 跳转，直接驱动进程内 ctx.debug 缝。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tui-debug

[English](README.md) | 中文

## 概述

面向 TUI 的终端调试面板、`:debug` 命令族、源码预览与 `$EDITOR` 跳转。面板直接折叠进程内 `ctx.debug` 事件流——不经 Remote 层——因此 TUI 运行时保持零 PTY 依赖。在 DAP 会话面落地之前，launch 与 attach 呈现调试服务自身的 `DEBUG_UNAVAILABLE` 通知；run-in-terminal 请求由组合层经 `ctx.terminals` 满足，不经过本包。

## 目录

- [使用本包](#use-this-package)
- [提供的构件](#what-it-provides)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

经同时提供 `ctx.debug` 的组合层加载插件；`ctx.debug` 缺席时插件跳过自身。插件提供 `apps/tui` 渲染的可选 `tuiDebugPane` 服务：该服务拥有 `:` 命令解析、面板 reducer 与渲染器，以及功能键表（f5、shift-f5、f9、f10、f11、shift-f11）。`run` 接受原始 `:` 行，对非调试命令与应用自有命令返回 false；`runKey` 映射调试功能键；`openEditor` 在 `$EDITOR` 中跳到当前源码位置。

<a id="what-it-provides"></a>
## 提供的构件

- `parseDebugCommand` — 设计 9.8.3 表中的封闭命令族，带 `if` 与 `log` 子句，失败为类型化 `DebugError`（`DEBUG_UNKNOWN_OPERATION`、`DEBUG_INVALID_CONFIG`）。
- `createDebugPaneState` / `foldDebugEvent` / `renderDebugPaneLines` — 覆盖封闭 `DebugEvent` 联合的纯 reducer 与纯文本渲染器；空小节保持不可见。
- `readSourceWindow` — 停止位置周边的有界源码预览，超过 `DEFAULT_MAX_SCAN_BYTES` 上限时以 `SOURCE_WINDOW_TOO_LARGE` 失败。
- `editorCommand` / `openInEditor` — `$EDITOR` argv 交接（`+<line> file`），仅 argv、不经 shell。
- `apply(ctx)` — 插件本体：订阅 `ctx.debug.events`、提供 `tuiDebugPane`，卸载时一并释放。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

<a id="model-experience"></a>
## 模型体验（Model Experience）

无：本包在终端侧提供调试面板与命令，消费已记录事件，不组装任何模型请求。

#### KV Cache 影响

无；本包既不组装也不发送任何提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- launch 与 attach 以 `DEBUG_UNAVAILABLE` 应答：这些操作的 DAP 会话面尚未落地，面板只观察 `ctx.debug` 事件，不驱动会话。
- 面板没有停住位置或失败码通道；基于归一化的一致性套件在该端将这些组留空。
- run-in-terminal 请求由组合层经 `ctx.terminals` 满足，不经过本包。
- 源码预览受 `DEFAULT_MAX_SCAN_BYTES` 限界，超限以 `SOURCE_WINDOW_TOO_LARGE` 失败。
