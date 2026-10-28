---
description: "dsh 的交互式终端 UI profile：在同一个 agent 会话上提供聊天、分屏与调试三种布局，供偏好终端的用户使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-app

[English](README.md) | 中文

## 概述

`dsh-tui-app` 组合 TUI profile（`dsh --profile tui`）：在同一 agent 会话、工具与安全默认值之上的交互式终端 UI。组合层堆叠 `dsh-base` 与 TUI 应用插件，因此 profile 携带完整 harness；TUI 增加三种布局（默认 Chat、F7 Split、F6 Debug）、冒号前缀命令（`:debug`、`:break`）以及 `--session-id` 会话恢复。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

启动新交互会话：

```sh
dsh --profile tui
```

恢复已有会话：

```sh
dsh --profile tui --session-id session-…
```

普通文本即提示词；前导 `:` 启动命令（`:help` 查看列表）。TUI 与 agent 会话同进程运行——无浏览器、无 Remote 层、无额外端口。

-----

<a id="model-experience"></a>
## 模型体验（Model Experience）

无：组合包自身不携带任何模型可见内容；堆叠的插件拥有每个模型可见界面。

#### KV Cache 影响

组合包不向请求前缀添加任何内容；提示词小节或 schema 的变化归堆叠插件所有。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- TUI 每进程承载一个交互会话：没有浏览器与 Remote 层、没有多会话标签组、也没有额外端口。
- Debug 布局的 launch 与 attach 命令在 DAP 会话面落地前以 `DEBUG_UNAVAILABLE` 应答；该通知归 `tui-debug` 所有。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
