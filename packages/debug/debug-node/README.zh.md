---
description: "注册到 ctx.debug 的 Node.js/TypeScript 调试 provider：按冻结计划形状解析 launch/attach、带 GitHub 官方 SHA-256 摘要的 js-debug 清单与响亮的 Node 配置校验，供组合 Node 调试的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-debug-node

[English](README.md) | 中文

## 概述

使用 `dsh-debug-node` 为组合提供 Node.js 与 TypeScript 调试。插件在 `ctx.debug` 注册一个 provider（js/mts/tsx 系扩展名），并在 `ctx.debugAdapters` 已组合时注册经核实的 js-debug 清单。`resolveLaunch` 把请求解析为冻结的 `DebugLaunchPlan`——适配器命令、DAP launch 请求、目标进程、`processControl` 能力要求与可操作的失败提示；`resolveAttach` 只接受进程 id、inspector 端口、URL 三者之一。provider 选项（`runtimeExecutable`、`runtimeArgs`、`autoAttachChildProcesses`、`sourceMaps`、`outFiles`、`console`）响亮校验：未知选项失败，已知选项显式映射进 DAP 请求。

## 目录

- [使用本包](#use-this-package)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `dsh-debug`（必需）之后、可选的 `dsh-debug-adapter-manager` 之后组合本插件。清单把 js-debug v1.140.0 固定到其 GitHub release 归档；SHA-256 采用 GitHub 为该资产发布的官方 digest，同一归档服务全部平台（js-debug 为纯 JavaScript）。disposal 一并释放 provider 与清单。

请求与选项校验失败携带 `DEBUG_INVALID_CONFIG`；适配器缺失经由环境的适配器解析表现为 `DEBUG_ADAPTER_NOT_FOUND`/`DEBUG_ADAPTER_UNSUPPORTED`。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 归档内部布局（DAP 入口为 `js-debug/src/dapDebugServer.js`）依据上游文档与计划；本环境无法下载归档列目录验证，留待适配器矩阵任务的真实 e2e 验证。
- js-debug 的 `${webServer}` 复合 launch 配方、`attachForSourcemappedBreakpoints` 与 vscode-pwa 远端目标未建模。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
