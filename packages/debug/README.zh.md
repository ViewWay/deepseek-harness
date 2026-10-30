---
description: "debug 组地图：ctx.debug 能力缝及其提供方、适配器与三端界面，覆盖 IDE 级调试，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# debug/ — IDE 级调试

[English](README.md) | 中文

## 概述

debug 组通过唯一的 `ctx.debug` 能力缝为 agent（智能体）与人提供 IDE 级调试（子系统契约见 [docs/subsystems/debug.zh.md](../../docs/subsystems/debug.zh.md)）：在本机、SSH 与沙箱执行世界中 launch/attach Node.js/TypeScript、Python、Go、Rust/C/C++ 会话，含断点、调用栈、变量与有界输出。共享的 `debug` 包拥有 seam 词汇、会话状态机、provider 注册表与 Session 事件；其余包提供适配器、语言 provider、工具与 Web/Desktop/CLI 界面。Debug Adapter Protocol 保持在 seam 之后。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`debug/`](debug/README.zh.md) | 定义调试能力缝：品牌化词汇、类型化错误、会话状态机、provider 注册表、live 事件、耐久 `debug/*` Session 事件与 `debugSessions` 投影 | `ctx.debug` |

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

工具层对操作面做端到端分派：`dsh-tool-debug` 经 `ctx.debug` 后端注册表把每个 `debug_execution` 与 `debug_inspect` 调用解析到统一的 `DebugSessionOperations` 契约上，把 `memoryReference` 锚点从 inspection 结果传入内存与反汇编操作，并把 `breakpoint_locations` 交给适配器解析。能力门控在实践中按 provider 拉开差距（上游能力声明，2026-10：setVariable 全员支持，restartFrame 仅 vscode-js-debug，debugpy 缺内存读写，delve 缺 completions）；完整矩阵见[适配器能力缝记录](../../.agents/notes/proposed/architecture/2026-10-25-debug-adapter-seam.zh.md)。`capabilities/changed` 通道已存在于后端层——握手后与 DAP capabilities 事件时发出——其接入领域事件等待会话面组合（下一波）；UI 门控尚未在生产可用。

</details>
