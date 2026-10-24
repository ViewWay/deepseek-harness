---
description: "调试能力缝（ctx.debug）：冻结的调试词汇与品牌化 id、类型化 DebugError 失败、会话状态机与语言 provider 注册表，供组合 IDE 级调试的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-debug

[English](README.md) | 中文

## 概述

使用 `dsh-debug` 为 harness 提供唯一的调试能力缝。本包拥有所有调试界面共享的冻结契约：品牌化 id（`DebugSessionId`、`DebugProviderId` 等）、请求/provider/计划词汇、带稳定错误码的类型化 `DebugError` 分类、五状态会话状态机，以及原子保留 provider id 与文件扩展名的语言 provider 注册表。会话生命周期（注册表支撑的 list/get、launch/attach、复合配置、live 事件、耐久 `debug/*` Session 事件与 `debugSessions` 投影）在本分支后续 IDE 调试任务中挂载到本服务；在那之前本包只暴露词汇、状态机与注册表。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载本服务即拥有 `ctx.debug`。语言 provider 以品牌化 id、显示名、文件扩展名、适配器描述符、配置 schema 与两个显式 resolve 步骤（`resolveLaunch`/`resolveAttach`）注册，把请求解析为完整计划。注册在改动前完成全部校验：空 id、空或非法的扩展名列表、重复扩展名以 `DEBUG_INVALID_PROVIDER` 失败；已保留的 id 或扩展名以 `DEBUG_CONFLICT` 失败；返回的 disposer 一并释放全部保留，HMR 重载不留下过期路由。

会话状态机是所有会话遵循的唯一转移表：`starting → running ⇄ stopped`，`terminated`/`failed` 为吸收态，重复 `terminate`/`disconnect` 幂等。非法组合抛出带 `DEBUG_INVALID_STATE` 的 `DebugError`；调用方按 `code` 分支，需要时读取 `providerId`/`sessionId`/`workspaceId`/`detail`，绝不解析 `message`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

- **冻结契约。** `src/types.ts` 逐字承载已评审的契约（Shared Interfaces + 设计第 4 节，2026-10-25 评审修正）；任何漂移都是契约变更，先改设计与计划再改本文件。
- **只用品牌化 id。** 所有跨界 id 都是来自 `dsh-brand` 的 `Branded<B>` 值。DAP 的数字型 `threadId`/`frameId`/`variablesReference`/`breakpoint.id`/`sourceReference` 只在 `debug-dap` 后端与品牌值互转；本包公共类型不出现裸数字 id。
- **原子注册。** `registerProvider()` 先规范化扩展名（小写、前导点）、拒绝 provider 内重复，再对 id 与扩展名做冲突检查，然后由一个 `ctx.effect()` 一并提交两类保留；生成器的清理一起释放。
- **穷尽状态机。** `advanceDebugState` 读取全量的 `Record<DebugSessionState, …>` 表，未列出的组合抛类型化失败；`debugTerminalOutcome` 对封闭事件 union 做 switch，并带编译期穷尽守卫。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Debug` 服务（`registerProvider`/`provider`/`providers`）与 `ctx.debug` 合并 |
| [`src/brand.ts`](src/brand.ts) | 八个品牌化 id 类型及其构造器 |
| [`src/types.ts`](src/types.ts) | 冻结的 seam 契约与 `DebugErrorCode` union |
| [`src/error.ts`](src/error.ts) | `DebugError`（`HarnessError` 子类），携带身份与修复上下文 |
| [`src/state.ts`](src/state.ts) | 七事件转移表上的 `advanceDebugState` 与 `debugTerminalOutcome` |

</details>

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 会话生命周期尚未挂载：launch/attach、会话注册表、live 事件、耐久 `debug/*` Session 事件与 `debugSessions` 投影随本分支后续 IDE 调试任务落地。
- `DebugAttachPlan` 与 `DebugAttachTarget` 是 provider 契约引用但未细化的 attach 形状的补缺定义；设计文档记录之前以本包为家。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
