---
description: "注册到 ctx.debug 的 Python 调试 provider：带解释器校验的 launch/attach 冻结形状解析与 debugpy 选项白名单，供组合 Python 调试的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-debug-python

[English](README.md) | 中文

## 概述

使用 `dsh-debug-python` 为组合提供 Python 调试。插件在 `ctx.debug` 注册一个 provider（`.py`/`.pyw` 扩展名）。`resolveLaunch` 把请求解析为冻结的 `DebugLaunchPlan`——适配器命令、DAP `debugpy` launch 请求（program 或 module、必填的 `python` 解释器、映射的 `justMyCode`/`subProcess`/`django`/`flask` 选项）、以解释器运行入口的目标进程，以及 `python` 执行能力。`resolveAttach` 只接受进程 id 与 debugpy 监听端口二者之一。未知选项响亮失败；解释器选项必填。

## 目录

- [使用本包](#use-this-package)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `dsh-debug` 之后组合本插件。请求以 `DEBUG_INVALID_CONFIG` 校验：入口互斥、解释器缺失、未知 provider 选项；适配器缺失经由环境的适配器解析表现。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 托管 debugpy 清单待 venv 安装模型落地后再注册（上游已核实：debugpy 1.8.22、MIT、按 Python 版本×平台的 wheel 带 PyPI 官方 digest）。
- `internalConsole` 式 console 路由、`pyramid`/`gevent` 选项与 URL attach 未建模。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
