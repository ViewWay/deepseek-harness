---
description: "dsh 的调试可选组合层：ctx.debug 能力缝、四个语言 provider、Agent 调试工具、Remote 控制器与 Web/Desktop 工作台，叠加在任意 dsh-base profile 之上。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-debug-bundle

[English](README.md) | 中文

## 概述

`dsh-debug-bundle` 把 IDE 级调试能力组合成一个官方可选 bundle：`ctx.debug` 服务缝、DAP 传输栈、适配器管理器、四个语言 provider（Node.js/TypeScript、Python、Go、Rust/C/C++）、面向模型的 `debug_*` 工具、服务 Web/Desktop 工作台的 Remote 调试控制器，以及编辑器与面板客户端插件。它登记在 `OPTIONAL_BUNDLES` 中，默认关闭，由 plugin manager 开启；没有任何 shipped profile 选中它（见[调试子系统页](../../../docs/subsystems/debug.zh.md)）。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

通过 plugin manager（Web/Desktop 的 Plugins 页）或 `dsh plugin` 开启本 bundle。开启后，运行中的 profile 挂载调试缝、provider 与工具；工作台行仅在 `web` 与 `desktop` profile 激活，headless、SDK 与 ACP 部署只加载模型侧。

适配器二进制从不随 bundle 安装。适配器管理器在首次使用时解析语言适配器、校验 SHA-256 摘要并安装到托管位置；偏好自有工具链的部署可以按 provider 覆盖适配器命令。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### base 之上的补丁面

一个 `insert` 块在 profile 之上堆叠十一行：`debug`（能力缝）、`debug-adapters`、四行 `debug-provider-*`、`tool-debug`、`debug-controller`（控制器包只导出具名类，bundle 把它再导出为默认插件），以及三行工作台 `ui-code-editor`、`ui-debug`、`ui-workbench`。工作台行带有 profile 守卫，在 `web` 与 `desktop` 之外禁用，因此 headless、SDK 与 ACP 部署只加载模型侧。

### 源码地图

- `cordis.patch.yml` — 上述各行的补丁。
- `src/debug-controller.ts` — `DebugController` 的默认插件再导出。
- `locale/*.json` — 八个发布语言的 plugin manager 显示元数据。
- `icon.svg` — plugin manager 图标。

-----

<a id="model-experience"></a>
## 开发备注

bundle 只负责组合：这里没有任何调试行为。服务面、DAP 客户端、适配器管理器、provider、工具、控制器与客户端插件各自拥有自己的 README。

## Model Experience

### debug 工具

#### 模型看到什么

四个 `debug_session`、`debug_execution`、`debug_inspect`、`debug_breakpoints` 工具及其固定的 system-prompt 段来自堆叠的 `tool-debug` 行；bundle 自身不添加任何提示词文本。

#### Token 影响

完全由堆叠的插件承担；bundle 自身不增加任何内容。

#### KV Cache 影响

bundle 无贡献；工具 schema 与提示词段属于 `tool-debug`。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

这些限制说明开启 bundle 后的预期行为。它们是当前包约束，不是任务清单。

- **launch/attach 需要审批回答者** — 没有回答者的部署按 fail-closed 拒绝 launch 与 attach（`DEBUG_APPROVAL_DENIED`）；工具在错误详情中区分主动拒绝与缺少回答者。
- **工作台需要 GUI profile** — 编辑器、面板与工作台行在 headless、SDK 与 ACP 中保持关闭；在这些部署开启 bundle 只贡献 Agent 工具。
- **适配器按需安装** — 每个语言的首次调试会话会下载并校验适配器；离线部署必须在 launch 前通过 provider 覆盖提供适配器命令。
- **图标设计评审待完成** — 图标遵循官方 artwork 约束并通过 `verify-package-meta`，但设计者尚未确认该新图形。
