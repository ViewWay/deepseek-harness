---
description: "面向模型的调试工具（ctx.debug 之上）：四个注册工具带封闭操作 union、有界规范结果、固定系统提示词段与纯渲染函数，供组合 agent 调试的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-debug

[English](README.md) | 中文

## 概述

使用 `dsh-tool-debug` 把调试 seam 暴露给模型。插件注册四个工具——`debug_session`、`debug_execution`、`debug_inspect`、`debug_breakpoints`——各自带封闭操作 union，未知操作以 `DEBUG_UNKNOWN_OPERATION` 拒绝。会话 list/get/terminate/disconnect 与工作区作用域的文件断点替换直接运行在 `ctx.debug` 上；execution 与 inspection 分派到会话已注册的后端，缺后端时类型化失败 `DEBUG_UNAVAILABLE`。launch 与 attach 经审批门后委派给编排器缝；内存写入每次请求审批；停驻通知按 Config 到达所属会话。系统提示词段定位其用法：仅限运行态相关失败、启动前设断点、最小化求值、结束前终止会话、导航用文件/LSP 工具。

## 目录

- [使用本包](#use-this-package)
- [开发备注](#dev-note)
- [Model Experience](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `dsh-debug` 之后组合本插件。工具先校验操作 union，再校验会话 id 与各操作字段；领域失败以模型可读的 `DebugError` code 呈现。launch 与 attach 需要 `providerId`、`workspaceId`、`workspaceRoot` 与 `cwd`（launch）：Agent 调用 fail-closed 地经过 `ctx.approval`，调用会话拥有新调试会话，耐久 `debug/control` 审计落在该会话的日志上；UI 发起的 launch 在 UI 内确认，绕过 Agent 审批缝。execution 与 inspection 经 `ctx.debug` 后端注册表解析会话后端，因此组合方必须为每个活跃会话注册一个后端。引用参数（`threadId`、`frameId`、`variablesReference`、`sourceReference`）是 seam 的序列化字符串 id，从先前结果原样回传；`memoryReference` 锚点从 `variables`、`evaluate`、`disassemble` 的结果传入 `read_memory`、`write_memory` 与 `disassemble`。断点操作带显式 `workspaceId`；无 `sessionId` 时作用于持久化工作区集合并应用到全部匹配的活跃会话，带 `sessionId` 时限定单会话（会话面落地前类型化不可用）。渲染把栈源路径相对化到工作区、按上限截断值并保留子引用、每个有界视图都带 `truncated`/`total`。停驻通知按插件 Config 流动：`debugStopDelivery`（唤醒或安静）、`debugMaxConsecutiveWakes` 与 `maxNoticeBytes`。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

-----

<a id="model-experience"></a>
## Model Experience

### 系统提示词

#### 模型可见内容

一个系统提示词段（注册在 LSP 工具段之后）以如下文本定位四个调试工具：

##### 逐字指引

```markdown
Use the debug tools when a failure depends on runtime state that reading code and tests cannot explain. Set breakpoints before launching; after a stop, inspect threads, the stack, and scopes before stepping or continuing. Evaluate only the minimal necessary expressions; memory writes need an explicit justification and approval. Terminate every debug session you started before finishing; do not leave background debug processes running. Use file and language-server tools for ordinary code navigation; do not substitute the debugger for search.
```

#### Token 影响

插件激活期间每次请求承担固定的指引成本。

#### KV Cache 影响

插件作用域与指引文本不变时前缀稳定；激活或停用可能使本段起的缓存复用失效。

### 工具 schema

#### 模型可见内容

四个工具 schema，各带封闭 `operation` 枚举，枚举值与其 union 的词汇逐字一致：`debug_session`（launch、attach、launch_compound、list、list_compounds、get、get_compound、terminate、terminate_compound、disconnect、attach_targets）、`debug_execution`（continue、pause、step_over、step_in、step_out、step_back、restart、restart_frame、wait_for_stop）、`debug_inspect`（threads、stack_trace、scopes、variables、evaluate、set_variable、set_expression、completions、exception_info、modules、loaded_sources、source、disassemble、read_memory、write_memory、breakpoint_locations、console）、`debug_breakpoints`（set_file、set_function、set_exception、set_data、set_instruction、list、clear）。模型可见的生成 schema 见[调试工具 schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-debug)。

#### Token 影响

启用期间每次请求承担固定的 schema 成本；四个枚举各把全部操作名列出一次。

#### KV Cache 影响

可见工具定义与顺序不变时前缀稳定；注册生命周期或作用域限制可能使首个变化 schema token 起的缓存复用失效。

### 结果

#### 模型可见内容

有界规范 JSON：会话列表与信息为纯记录；栈带工作区相对源路径与帧上限（每个有界视图都带 `truncated`/`total`）；变量带每值上限并保留子级 `variablesReference` 供懒展开。恢复类操作返回结算——`kind` 为 stopped（带工作区相对停驻位置）、terminated 或 running。launch 与 attach 返回会话记录并带控制授权来源（`grantedBy`）。内存读取返回 base64 `data`、解析出的 `address` 与 `unreadableBytes` 尾部；内存写入在适配器报告时返回 `offset`/`bytesWritten` 报告；`breakpoint_locations` 返回按行列排序的适配器解析位置。领域失败以模型可路由的 `DebugError` code 呈现（`DEBUG_UNKNOWN_OPERATION`、`DEBUG_SESSION_GONE`、`DEBUG_UNAVAILABLE`、`DEBUG_INVALID_CONFIG`、`DEBUG_APPROVAL_DENIED`、`DEBUG_CONTROL_NOT_GRANTED`、`DEBUG_BREAKPOINT_LIMIT`），无需解析 message 文本。

#### Token 影响

每个视图受渲染上限约束（帧上限、值上限）；断点应用结果枚举 applied 与 rejected 两侧。

#### KV Cache 影响

工具结果追加在缓存请求前缀之后，不直接使其失效。

### UI 呈现

#### 模型可见内容

无。客户端从原始工具结果渲染通用卡片；本任务不交付调试专用 presenter。

#### Token 影响

渲染仅发生在客户端，直接 token 影响为零。

#### KV Cache 影响

无；UI 呈现在模型请求之外。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- launch 与 attach 经审批门后委派给已安装的编排器；未安装编排器的组合按 `DEBUG_UNAVAILABLE` fail-closed，且 Agent 调用额外需要审批回答者。`wait_for_stop` 在其停驻事件面落地前同样类型化失败。
- execution 与 inspection 在会话已注册的后端上分派；适配器缺少对应能力的操作在后端以 `DEBUG_UNSUPPORTED_CAPABILITY` 失败，因此各 provider 的覆盖随适配器不同。
- variables、modules 与 console 的分页选项尚未暴露；这些操作读取后端的默认页。
- 复合操作、attach 目标探测、函数/异常/数据/指令断点、持久化集合的读取面随后端服务落地。
