---
description: "真实适配器调试 e2e 矩阵工具：工具链探测、跳过原因记录与 SSH 世界桩。"
kind: "package-library"
---

# @deepseek-ai/dsh-debug-e2e

[English](README.md) | 中文

## 概述

`dsh-debug-e2e` 承载真实适配器调试矩阵。`skipWithoutAdapter` 探测各语言工具链与适配器覆盖路径（`DSH_E2E_<LANGUAGE>_ADAPTER`），任一缺失时返回被记录的跳过原因——绝不 mock；Node 与 Python 闭环用例据此自跳，Go 与 Native 显式记录跳过，SSH 用例在 ssh 世界 fixture 接线前固定隧道传输的 attach-unsupported 行为。`launchFixture` 在完整组合就位前显式失败。

## 已知限制与延期工作

这些限制界定了本工具需要谨慎使用的场景，是当前包约束，不是任务清单。

- **launchFixture 按设计显式失败** — 真实组合（provider、适配器管理器、执行世界）随完整 Task 25b 矩阵落地；适配器在场时也不允许跑半接线工具。
- **SSH 世界是桩** — 隧道路径在无可达 ssh 服务时断言 `DEBUG_ATTACH_UNSUPPORTED`；基于 ssh 的 stdio fixture 随 Task 25b 落地。
- **暂无沙箱用例** — 沙箱通道随完整矩阵落地。
