---
description: "托管调试适配器服务（ctx.debugAdapters）：带逐平台 SHA-256 记录的校验清单、校验和验证与自检回滚的安装、并发安装共享，以及面向目标执行世界、绝不回退宿主适配器的解析，供组合托管调试的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-debug-adapter-manager

[English](README.md) | 中文

## 概述

使用 `dsh-debug-adapter-manager` 拥有 `ctx.debugAdapters`：校验并注册适配器清单（固定版本、带 SHA-256 摘要的逐平台下载记录、许可证与所需执行能力），把适配器安装进目标执行世界——强制校验和验证，握手自检失败则回滚整个安装——同一 provider/平台的并发安装共享一次操作，且解析已安装适配器时绝不替远程世界回退到宿主副本。未发布的平台保持缺席：解析以 `DEBUG_ADAPTER_UNSUPPORTED` 拒绝，而不是模拟兼容。本管理器不做任何审批：调用方先完成用户确认。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在适用托管适配器的组合中挂载本服务。把每个 provider 的清单数据（从仓库文件读出）注册进来；注册完成全部校验，disposer 释放记录。安装时传入目标世界的 I/O（`fetchBytes`、`write`、`remove`、`exists`、`runSelfTest`）与该世界的安装根——安装器写入 `<root>/<provider>/<version>/<platform>/`，写入前先验证归档摘要，校验和或自检失败即删除目录。`resolve` 只在目标世界存在可执行文件时返回该世界的适配器命令；缺失安装以 `DEBUG_ADAPTER_NOT_FOUND` 失败，不用宿主副本顶替。

失败全部类型化：清单畸形（含 `latest` 版本与未知字段）→ `DEBUG_INVALID_CONFIG`；摘要格式非法与下载不匹配 → `DEBUG_ADAPTER_CHECKSUM`；未发布平台、托管安装下的 system 源、自检失败 → `DEBUG_ADAPTER_UNSUPPORTED`；未注册 provider 与缺失安装 → `DEBUG_ADAPTER_NOT_FOUND`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

- **数据边界校验。** 清单是跨文件边界的仓库数据：`parseAdapterManifest` 逐元素校验每个字段、以无断言方式构建类型化值；唯一的品牌化转换发生在已校验的 provider id 上。
- **世界作用域 I/O。** 安装器与解析器接收显式的 `DebugAdapterInstallEnvironment`，绝不触碰宿主 Node API，本机、SSH 与沙箱世界经由各自的桥接安装。
- **先提交后发布。** 安装生命周期事件（`adapter/installed`、`adapter/uninstalled`、`adapter/install-failed`）只在操作落定后发布；listener 失败被 containment。
- **共享在途操作。** 同一 provider/平台的并发安装共享一个 Promise，双击只下载一次。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/manifest.ts`](src/manifest.ts) | 清单校验、平台键与未发布平台拒绝 |
| [`src/install.ts`](src/install.ts) | 校验和验证安装、自检回滚与安装布局解析 |
| [`src/manager.ts`](src/manager.ts) | `ctx.debugAdapters`：注册表、共享安装、解析与生命周期事件 |

</details>

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 从完整 `DebugEnvironment`（subprocess 与 fs 服务）到安装环境的桥接随执行世界任务落地；本包定义并消费窄 I/O 面。
- 单文件校验和写入之外的归档解包与安装进度取消随适配器矩阵任务落地；归档自检执行 `<executable> --version`，pypi 安装在 venv 内做导入自检。
- wheel 选择读取默认 PyPI index；部署级 index 覆盖随适配器矩阵任务落地。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
