---
description: "注册到 ctx.debug 的 Go 调试 provider：面向 delve 的 launch/attach 冻结形状解析，附经核实的 v1.27.2 逐平台清单 digest，供组合 Go 调试的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-debug-go

[English](README.md) | 中文

## 概述

使用 `dsh-debug-go` 为组合提供 Go 调试。插件在 `ctx.debug` 注册一个 provider（`.go` 扩展名），并在 `ctx.debugAdapters` 已组合时注册经核实的 delve 清单。`resolveLaunch` 把请求解析为冻结的 `DebugLaunchPlan`——适配器命令、DAP `go` launch 请求（program 或 package、delve `mode`、`buildFlags`、`dlvFlags`）、以 delve 进程为目标，以及 `go` 执行能力。`resolveAttach` 只接受进程 id 与 delve headless 端口二者之一。未知选项与模式响亮失败。

## 目录

- [使用本包](#use-this-package)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `dsh-debug`（必需）之后、可选的 `dsh-debug-adapter-manager` 之后组合本插件。清单把 delve v1.27.2 按平台归档固定，digest 取 GitHub 发布的官方 SHA-256；同一 release 还带 PGP 签名的 checksums 文件。disposal 一并释放 provider 与清单。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 归档内部布局（`dlv` / `dlv.exe` 位于归档根）依据上游 release 文档；本环境无法下载归档开箱验证，留待适配器矩阵任务的真实 e2e 验证——本机缺失的 Go 工具链同样在该任务显式 skip 并记录原因。
- delve 的 `core` dump 模式、`--only-same-user` 调节项与 remote 模式 attach 路由未建模。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
