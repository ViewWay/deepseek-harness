---
description: "调试 seam 测试的类型化 fixture 工厂：从种子确定性生成 debug-<16 位十六进制> 格式的品牌化会话 id 与 Debug* 值，供编写或评审调试测试的维护者阅读。"
kind: "package-library"
---

# @deepseek-ai/dsh-debug-fixture

[English](README.md) | 中文

## 概述

使用 `dsh-debug-fixture` 通过类型化工厂构造每个 `Debug*` 测试值，而不是 `as never` 或 `as unknown` 断言。工厂负责品牌化 id，并从数字种子确定性生成 seam 的 `debug-` + 16 位小写十六进制会话 id 格式，失败的测试因此引用稳定且格式正确的 id。缺少工厂形状时先报告契约缺口；不允许用断言绕过。本包仅用于测试：不注册任何内容，不进入产品组合。

## 目录

- [使用本包](#use-this-package)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

导入被测值对应的工厂并传入一个小的稳定种子。`fixtureDebugSessionId(1)` 生成品牌化的 `DebugSessionId`，值为 `debug-0000000000000001`。种子必须是非负安全整数；其他值在构造时抛出 `RangeError`，让坏种子在所属测试处失败。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 工厂覆盖随 seam 的消费者增长：停住快照、栈帧、线程、复合子项与会话头随固化其行为的任务一起提供。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
