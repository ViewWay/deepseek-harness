---
description: "调试能力缝（ctx.debug）：冻结的调试词汇与品牌化 id、类型化 DebugError 失败、会话状态机、provider 注册表、带 live 事件的工作区作用域会话注册表、复合配置、耐久 debug 事件与 debugSessions 投影，供组合 IDE 级调试的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-debug

[English](README.md) | 中文

## 概述

使用 `dsh-debug` 为 harness 提供唯一的调试能力缝。本包拥有所有调试界面共享的冻结契约：品牌化 id（`DebugSessionId`、`DebugProviderId` 等）、请求/provider/计划词汇、带稳定错误码的类型化 `DebugError` 分类、五状态会话状态机、原子保留 provider id 与文件扩展名的语言 provider 注册表、带 live 事件与幂等拆除的工作区作用域会话注册表、带 stop-all 策略的复合配置、耐久 `debug/*` Session 事件与 `debug` 消息来源，以及注册到 `ctx.sessionProjections` 的 `debugSessions` 投影。launch 与 attach 在 DAP 后端落地前以 `DEBUG_UNAVAILABLE` 拒绝；耐久事件的写入随后端落地。

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

注册的会话存放在 `ctx.debug.sessions` 背后的工作区作用域注册表：`list`/`get` 读取它；`events` 只在所属状态提交后发布 live 的 `session/*`、`breakpoint/changed`、`console/output`、`adapter/output` 与 `capabilities/changed` 通知；拆除恰好执行一次 dispose 后才发布 `session/terminated`。跨工作区读取以 `DEBUG_WORKSPACE_MISMATCH` 失败。复合配置按有序会话列表聚合状态并携带 stop-all 策略。

耐久调试事实使用 `debug/session-started`、`debug/stopped`、`debug/session-ended` 与 `debug/control` Session 事件，写入时一律带 `ignorable: true` 信封标记，未加载本插件的 reader 会安全跳过；`SESSION_FORMAT_VERSION` 不变。载荷只携带 id 与审计事实——绝不携带变量值、内存、环境变量值或 DAP 帧——id 以序列化字符串形式传输，重放不得当作可继续使用的句柄。`debugSessions` 投影把这些事件折叠为有界视图（Config：`maxProjectedSessions`、`maxProjectedStops`），用于重连与会话列表；它不进入系统提示词。`debug` 消息来源为本 seam 消费者注入的模型可见通知提供归属。

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
| [`src/index.ts`](src/index.ts) | 插件入口：`Debug` 服务（`registerProvider`/`provider`/`providers`、`sessions`、`list`/`get`、`events`、launch/attach 守卫）与 `ctx.debug` 合并 |
| [`src/brand.ts`](src/brand.ts) | 八个品牌化 id 类型及其构造器 |
| [`src/types.ts`](src/types.ts) | 冻结的 seam 契约、`DebugErrorCode` union 与检视词汇（栈、变量、求值、断点、异常、模块、反汇编、内存、控制台） |
| [`src/error.ts`](src/error.ts) | `DebugError`（`HarnessError` 子类），携带身份与修复上下文 |
| [`src/state.ts`](src/state.ts) | 七事件转移表上的 `advanceDebugState` 与 `debugTerminalOutcome` |
| [`src/events.ts`](src/events.ts) | live `DebugEvent` union、`DebugEventSource` 与 containment 派发总线 |
| [`src/registry.ts`](src/registry.ts) | 工作区作用域会话注册表：先提交后发布、幂等移除 |
| [`src/session.ts`](src/session.ts) | `DebugSessionRecord` 与 live 会话的拆除面 |
| [`src/compound.ts`](src/compound.ts) | 复合会话：stop-all 传播与聚合状态 |
| [`src/session-events.ts`](src/session-events.ts) | 耐久 `debug/*` Session 事件载荷与 `debug` 消息来源 |
| [`src/projection.ts`](src/projection.ts) | 有界的 `debugSessions` 投影与保留上限工厂 |
| [`src/launch-config.ts`](src/launch-config.ts) | `.dsh/debug.json` 解析：六变量展开与类型化配置失败 |
| [`src/environment.ts`](src/environment.ts) | 经世界自身服务的执行环境探测与类型化能力检查 |
| [`src/archive-admission.ts`](src/archive-admission.ts) | Workspace 归档 admission 的 `debug` 家族：报告自有活跃会话、归档时终止 |

</details>

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- launch 与 attach 以 `DEBUG_UNAVAILABLE` 拒绝，且尚无组件写入耐久 `debug/*` 事件；DAP 后端与耐久事件写入随本分支后续 IDE 调试任务落地。
- live 会话的 `terminate` 与 `disconnect` 共享一条拆除路径；两个不同的 DAP 请求、复合配置的 `restart` 与会话的检视方法（类型已由导出词汇定义）随后端落地。
- `DebugAttachPlan` 与 `DebugAttachTarget` 是 provider 契约引用但未细化的 attach 形状的补缺定义；设计文档记录之前以本包为家。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
