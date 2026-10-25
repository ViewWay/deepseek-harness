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

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

Ink 交互环、审批回答器与调试面板随本分支后续批次落地。

</details>

-----

## Model Experience

None, as the composition bundle carries no model-facing content of its own; the stacked plugins own every model-visible surface.

#### KV Cache effect

The bundle adds nothing to the request prefix; the stacked plugins own any prompt-section or schema changes.
