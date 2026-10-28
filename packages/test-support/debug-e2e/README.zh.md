---
description: "真实适配器调试 e2e 矩阵工具：launchFixture 将既有编排与真实 js-debug、debugpy 适配器组合；Go/Native 显式记录跳过；SSH 与沙箱保持桩。"
kind: "package-library"
---

# @deepseek-ai/dsh-debug-e2e

[English](README.md) | 中文

## 概述

`dsh-debug-e2e` 承载真实适配器调试矩阵。`launchFixture(language, { file })` 将既有启动编排（`launchDebugSession`）与真实语言 provider、真实适配器、真实 `DapDebugBackend` 组合——任何协议路径上都无 mock——通过 `ctx.debug.registerBackend` 注册后端，返回活会话上的操作句柄（`setBreakpoints`/`continue`/`step`/`terminate`）。Node 经回环 socket 桥接托管 js-debug 服务器；Python 在 stdio 上运行 debugpy 适配器，目标解释器即持有 venv 的解释器。`skipWithoutAdapter` 不启动任何进程即判定可用性并返回被记录的跳过原因；Go 与 Native 保持显式跳过。

## 目录

- [适配器供给](#adapter-provisioning)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="adapter-provisioning"></a>
## 适配器供给

供给在终端侧完成；本工具自身不做下载。适配器按适配器管理器的安装布局存放在 `$DSH_E2E_ADAPTER_ROOT`（默认 `~/.cache/dsh/debug-adapters`）下，`$DSH_E2E_<LANGUAGE>_ADAPTER` 按语言覆盖解析出的入口。

- **Node（js-debug 1.140.0）** — 从 `@deepseek-ai/dsh-debug-node` 清单记录的发布 URL 下载 `js-debug-dap-v1.140.0.tar.gz`，按清单校验 SHA-256，解压到 `<root>/node/1.140.0/<platform>/`（平台键如 `darwin-arm64`），使 `js-debug/src/dapDebugServer.js` 落位。fixture 以 `node <该路径> 0`（随机端口）启动并桥接其宣告的 socket。
- **Python（debugpy 1.8.22）** — 用任意解释器在 `<root>/python/1.8.22/venv` 建 venv 并 `pip install debugpy==1.8.22`；venv 的 `bin/python` 同时充当适配器与目标解释器，使 debugpy 可被被调试进程导入。

设置 `DSH_E2E_TRACE=1` 可将适配器的每个 DAP 事件镜像到测试日志。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

这些限制界定了本工具需要谨慎使用的场景，是当前包约束，不是任务清单。

- **Go/Native 为显式跳过** — `dlv`/`lldb-dap` 闭环随适配器矩阵后续任务落地；工具链在场也不会将它们提升为运行，`launchFixture` 被触及时显式失败。
- **SSH 世界是桩** — 隧道路径在无可达 ssh 服务时断言 `DEBUG_ATTACH_UNSUPPORTED`；基于 ssh 的 stdio fixture 随 ssh 世界任务落地。
- **Python 运行时能力未安装** — debugpy 的 launch-first 顺序绕过 `DapDebugBackend.start`，能力门控操作回退（terminate 降级为 disconnect），直至握手支持 early-launch 顺序。
- **沙箱世界是桩** — 用例经已发布的世界能力门断言（`DEBUG_SANDBOX_DENIED` 与 ptrace 平台拒绝），不含受禁锢世界；真实沙箱 profile 内的启动归 CI 平台矩阵。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
