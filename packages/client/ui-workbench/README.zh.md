---
description: "组成调试工作台的工作台布局、面板注册表与共享文件树、终端界面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

[English](README.md) | 中文

## 概述

工作台包拥有 Web/Desktop 调试工作台的布局：面板注册表、基于 `ui-dockkit` 的停靠排布、共享文件树与终端界面、响应式行为，以及编辑器与调试面板间的焦点路由。

## 目录

- [使用本包](#use-this-package)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

通过客户端插件加载器消费浏览器导出。本包注册其文案命名空间与面板贡献；它投影已记录的调试事件，从不组装模型请求。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

<a id="model-experience"></a>
## 模型体验（Model Experience）

无：本包是浏览器端的工作台布局与面板注册表，投影已记录事件，不组装任何模型请求。

#### KV Cache 影响

无；本包既不组装也不发送任何提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 持久化布局只保存打开面板的 id 与停靠位置；停靠尺寸与浮动位置是会话本地的，重新加载后复位。
- 工作台从不自行移动焦点：`focusOnStop` 只记录策略，由嵌入方自行路由焦点；屏幕阅读器播报走 live region。
- 恢复的布局命名了注册表已不再列出的面板 id 时，渲染器直接忽略，不视为错误。
