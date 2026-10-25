---
description: "注册到 ctx.debug 的 Rust/C/C++ 调试 provider：面向 lldb-dap 的 launch/attach 冻结形状解析，附经核实的 LLVM 23.1.4 归档清单 digest，供组合原生调试的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-debug-native

[English](README.md) | 中文

## 概述

使用 `dsh-debug-native` 为组合提供 Rust、C、C++ 调试。插件在 `ctx.debug` 注册一个 provider（rs/c/cpp/h 系扩展名），并在 `ctx.debugAdapters` 已组合时注册经核实的 LLVM 23.1.4 清单。`resolveLaunch` 要求程序二进制路径，把请求解析为冻结的 `DebugLaunchPlan`——适配器命令、DAP launch 请求、目标二进制，以及 `ptrace` 执行能力。`resolveAttach` 只接受进程 id（DAP `pid`）与 lldb-server 端口（翻译为 `attachCommands`）二者之一。不建模 provider launch 选项；未知选项响亮失败。

## 目录

- [使用本包](#use-this-package)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `dsh-debug`（必需）之后、可选的 `dsh-debug-adapter-manager` 之后组合本插件。清单按平台固定 LLVM 23.1.4，digest 取 GitHub 发布的官方 SHA-256；每条目都是完整工具链归档（0.9–2.0 GB，安装时展示大小），且 macOS Intel 无 LLVM release 二进制——系统安装（Xcode、发行版包）走用户覆盖。disposal 一并释放 provider 与清单。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 归档内部布局（`bin/lldb-dap`）依据上游 release 文档；本环境无法下载归档开箱验证，留待适配器矩阵任务的真实 e2e 验证——本机缺失的 lldb-dap 同样在该任务显式 skip 并记录原因。
- 自定义 LLDB init 脚本、`sourceMap` 重映射与 core dump 目标未建模。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
