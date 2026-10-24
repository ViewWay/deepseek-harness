---
description: "debug 组地图：ctx.debug 能力缝及其提供方、适配器与三端界面，覆盖 IDE 级调试，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# debug/ — IDE 级调试

[English](README.md) | 中文

## 概述

debug 组通过唯一的 `ctx.debug` 能力缝为 agent（智能体）与人提供 IDE 级调试：在本机、SSH 与沙箱执行世界中 launch/attach Node.js/TypeScript、Python、Go、Rust/C/C++ 会话，含断点、调用栈、变量与有界输出。共享的 `debug` 包拥有 seam 词汇、会话状态机、provider 注册表与 Session 事件；其余包提供调试适配器、语言 provider、工具与 Web/Desktop/CLI 界面。Debug Adapter Protocol 保持在 seam 之后，客户端不直接消费。

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

无。

</details>
