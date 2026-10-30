---
description: "远程调试控制面：会话、执行、检查与断点操作，以及单调事件回放游标。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-debug-controller

[English](README.md) | 中文

## 概述

`dsh-api-debug-controller` 经认证 Remote 向 Web 与 Desktop 暴露调试能力缝。Unary 方法按设计的资源分组——会话列表、执行控制（continue/pause/step/restart-frame）、检查（线程、栈、作用域、变量、set-variable/set-expression、补全、异常信息、模块、源、断点位置、反汇编）、base64 字节的内存读写、控制台分页与按文件断点替换；`events(sessionId, after)` 用单调 `debugEventSeq` 游标从有界环回放某会话的事件序列。落后于环保留期的游标以 `debug/event-cursor-expired` 应答，客户端据此重新同步而非静默丢事件。编辑器文件写入归另一个控制器。

## 目录

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验（Model Experience）

间接通过调试工具自身的结果：调试操作与事件回放仅经这些工具输出触达模型。

#### KV Cache 影响

Remote 调试调用不组装任何模型请求，提示词前缀与缓存上下文均不变。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

这些限制界定了本控制器需要谨慎使用的场景，是当前包约束，不是任务清单。

- **后端解析基于注册** — 执行与检查方法要求组合层接线 `ctx.debug.registerBackend`；未注册后端的会话以 `DEBUG_SESSION_GONE` 应答。
- **续接直播归组合层** — `events` 只回放保留历史；向已连接客户端流式推送新事件随 Remote 事件通道接线落地。
- **编辑器保存是唯一写路径** — `writeText` 完全委托 `ctx.fs` 版本守卫（冲突 `FS_STALE_VERSION`，expected version 为 `null` 走创建不覆盖）；逃逸路径在任何文件系统访问前以 `FS_PERMISSION_DENIED` 拒绝，不经此面暴露 rename/delete/mkdir。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
