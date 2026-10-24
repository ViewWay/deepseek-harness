---
description: "面向调试客户端栈测试的确定性内存版 Debug Adapter Protocol 假适配器，无需语言工具链。"
kind: "package-library"
---

# @deepseek-ai/dsh-fake-debug-adapter

[English](README.md) | 中文

## 概述

`dsh-fake-debug-adapter` 在测试进程内扮演 Debug Adapter Protocol 的一端：用固定 fixture 数据应答客户端请求，并按脚本回放注入条件（停住、挂起、非法帧、崩溃、延迟事件、stderr 文本与 `runInTerminal` 反向请求）。因此 DAP 客户端、握手与调试后端的测试不依赖真实调试器。消息顺序遵循协议：每个请求先收到它的响应，随后才是脚本排在其后的事件。

## 目录

- [使用本包](#use-this-package)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

创建适配器，用 `write` 喂入客户端消息，再用 `read`（消息）或 `readWire`（编码帧，唯一能看到非法块的面）消费适配器输出。

```ts
import { createFakeDebugAdapter } from '@deepseek-ai/dsh-fake-debug-adapter'

const adapter = createFakeDebugAdapter({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }] })
adapter.write({ seq: 1, type: 'request', command: 'initialize', arguments: {} })
await adapter.read() // initialize response with capability flags
await adapter.read() // initialized event
adapter.write({ seq: 2, type: 'request', command: 'launch', arguments: {} })
await adapter.read() // launch response
await adapter.read() // process event
await adapter.read() // stopped event at the first scripted stop
```

脚本字段：

| 字段 | 效果 |
|---|---|
| `capabilities` | 合并到 `initialize` 默认 capability 标志之上；未列出的标志被省略，DAP 将其定义为不支持 |
| `stops` | 每次推进触发一次（launch 前的 `configurationDone`、`launch`/`attach`、`continue`/`step*`、`restart`）；脚本耗尽时发出 `terminated` |
| `hang` | 列出的命令永远收不到响应 |
| `malformedAfter` | 在列出命令的正常输出之后发出一个非法 wire 块 |
| `delayedEvent` | 在收到第一条消息后经 unref 定时器发出一个事件 |
| `crashAfter` | 收到该命令即崩溃：挂起与后续读取以 `FakeDebugAdapterCrashError` 拒绝，排队输出被丢弃，后续写入被忽略 |
| `stderr` | 处理 `launch`/`attach` 时把被调试程序 stderr 记入 `stderrText` |
| `runInTerminal` | 在 `launch`/`attach` 响应与 `process` 事件之间发出 `runInTerminal` 反向请求；客户端响应记录进 `reverseRequestResponses` |

检查类请求（`threads`、`stackTrace`、`scopes`、`variables`、`evaluate`）返回确定性 fixture 数据，顶层栈帧位于最近一次脚本停住点。未知命令收到 `success: false` 响应；缺少必填字段的请求参数直接抛错，不做隐式转换。

## 已知限制与延期工作

这些限制界定了假适配器需要谨慎使用的场景，是当前包约束，不是任务清单。

- **fixture 数据固定** — threads、scopes、variables 与 evaluate 结果是常量；需要脚本化检查数据的消费方应扩展 `FakeDebugAdapterScript`，而不是绕着 fixture 写断言。
- **仅内存模式** — 尚无 stdio 进程模式；执行世界 e2e 覆盖将在消费本包时补启动器。
- **反向请求即发即忘** — 适配器记录客户端的 `runInTerminal` 响应，但 launch 流程不等待它。
