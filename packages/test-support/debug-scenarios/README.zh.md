---
description: "确定性三端调试场景：同一事实时间线分别驱动 web 视图 store、TUI 面板 reducer 与 headless NDJSON 投影，并经共享归一化器对比，供编写或评审调试一致性测试的维护者阅读。"
kind: "package-library"
---

# @deepseek-ai/dsh-debug-scenarios

[English](README.md) | 中文

## 概述

使用 `dsh-debug-scenarios` 证明调试三端一致。`debugScenario` 构造一条确定性事实时间线，`runScenario` 把它驱动进每端真实的 harness：web 视图 store、live `DebugEvent` 联合上的 TUI 面板 reducer，以及 `projectJsonRun` 的 headless NDJSON 投影。`normalizeSurfaceEvents` 剥离表现层字段，按各端通道实际保留的内容分组，一个测试即可在三端间比较生命周期事实，并在共享该通道的端对之间比较更丰富的事实。id 全部来自 `dsh-debug-fixture`；仅测试支持，不注册任何内容。

## 目录

- [使用本包](#use-this-package)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

按名称构造场景并在每端运行。`debugScenario('basic')` 由 agent 发起，设置一个已验证断点与一行被适配器拒绝的断点，依次经历 breakpoint、step、exception 三种停住并在停住间恢复，最后由 agent 终止；`debugScenario('human-agent-handoff')` 停住一次后把终止交给用户。选项可覆盖语言、源文件、停住序列、结束结果与 id 种子。`runScenario(surface, scenario)` 返回该端的折叠输出——store 状态、面板状态或 NDJSON 行——供表现层断言使用；`normalizeSurfaceEvents(run)` 返回分组记录（`sessions`、`stops`、`breakpoints`、`controls`、`failures`），保留会话 id、状态、停住原因、相对位置、断点验证、错误码与控制方。某端没有承载某事实族的通道时，该组为空。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- TUI 面板尚无停住位置与失败码通道，web store 不携带终止方；在会话面补齐这些事实之前，归一化器在这些端的对应组保持为空。
- headless 没有断点验证的持久通道——断点结果只存在于 live 事件流与 web 的 set-file 响应中——因此 headless 的断点组保持为空。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

场景时间线是持久提交粒度，因此每个事实都对应 seam 的已提交事实，任何端都不会看到会话日志无法重建的事件。

</details>
