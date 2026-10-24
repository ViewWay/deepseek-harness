---
description: "调试能力缝的 DAP wire 支持：Content-Length 分帧编解码、字节传输与请求客户端。"
kind: "package-library"
---

# @deepseek-ai/dsh-debug-dap

[English](README.md) | 中文

## 概述

`dsh-debug-dap` 为调试能力缝承载 Debug Adapter Protocol 的 wire 格式：编码/解码 `Content-Length` 帧，把适配器 stdio 管道与隧道 socket 归一成同一个 `DebugTransport` 形状，并用 `DapClient` 完成请求与响应的关联。客户端对所有格式合法的响应（包括 `success: false`）都 resolve，失败语义交给其上的握手层与会话后端。所有拒绝都是携带稳定错误码的 `DebugError`：请求中止为 `DEBUG_TIMEOUT`；销毁、适配器退出与发送失败为 `DEBUG_SESSION_GONE`；协议违规为 `DEBUG_MALFORMED_RESPONSE` 并同时终结客户端。

## 目录

- [使用本包](#use-this-package)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把传输包进客户端，发送请求，并订阅事件与反向请求。

```ts
import { DapClient, createStdioTransport } from '@deepseek-ai/dsh-debug-dap'

const client = new DapClient(createStdioTransport(adapterProcess))
client.onEvent(event => console.log(event.event))
client.onReverseRequest(async request => ({ processId: 42 }))
const response = await client.request('initialize', {
  clientID: 'dsh',
  linesStartAt1: true,
  columnsStartAt1: true,
  pathFormat: 'path',
}, AbortSignal.timeout(5000))
await client.dispose()
```

对调用方重要的契约：

- **帧** — `encodeDapFrame`/`decodeDapFrames` 遵循 DAP 基础协议；非法的 header、body 或超出单帧字节上限（默认 1 MiB，可按调用覆盖）都是 `DebugError('DEBUG_MALFORMED_RESPONSE')`，不完整的帧作为 `rest` 返回以便与下一块重组。
- **传输** — `createStdioTransport(process)` 接收带适配器 `stdin`/`stdout` 流的对象；`createTunnelTransport(socket)` 接收已连接的双工 socket。传输不负责 spawn 或连接；进程与隧道生命周期归执行世界所有。
- **客户端** — 请求携带单调递增序号，并接受由调用方按配置超时构造的 `AbortSignal`。适配器发起的请求经注册的反向请求处理器应答；未注册处理器时以 unsupported 失败应答，适配器不会挂起。监听器抛错与反向应答发送失败都被包容，不会打断读取循环。
- **终态** — 非法输入或无法匹配的响应会让客户端死亡，之后所有请求以留存的 `DEBUG_MALFORMED_RESPONSE` 拒绝；适配器输出结束、销毁或发送失败后，请求以 `DEBUG_SESSION_GONE` 拒绝。

## 已知限制与延期工作

这些限制界定了本库需要谨慎使用的场景，是当前包约束，不是任务清单。

- **不做请求串行化** — 客户端并发发送；调试能力缝设计中的每会话串行队列属于会话后端，不属于 wire 客户端。
- **不对反向请求做能力门控** — 客户端分发所有可解析的适配器发起请求；权限检查在后端层。
- **没有适配器 stderr 通道** — stdio 传输只承载帧管道；适配器 stderr 的收集归 launch 编排所有。
