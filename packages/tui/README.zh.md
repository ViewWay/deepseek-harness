---
description: "tui 分组地图：为 tui profile 折叠进程内 ctx.debug 事件流的终端调试面板。"
kind: "package-group"
---

# tui/：终端调试

[English](README.md) | 中文

## 概述

tui 分组承载 TUI 的调试面板：[`tui-debug`](tui-debug/README.zh.md) 提供终端应用渲染的调试面板——`:` 命令、功能键、有界面板、源码预览与 `$EDITOR` 交接——直接折叠进程内的 `ctx.debug` 事件流，没有 Remote 层，也没有 PTY 依赖。IDE 调试能力缝本身在 [debug 分组](../debug/README.zh.md)；本组是它的终端 Consumer。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`tui-debug`](tui-debug/README.zh.md) | 调试面板服务：命令解析、面板 reducer 与渲染、按键表、`$EDITOR` 交接 | `tuiDebugPane`（可选） |

终端契约记录在[调试子系统页](../../docs/subsystems/debug.zh.md)。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
