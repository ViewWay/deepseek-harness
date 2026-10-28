# Agent Note：调试会话吞吐基准 —— 时序归基准、上限归包内测试

Status: implemented

[English](2026-10-25-debug-session-throughput-benchmark.md) | 中文

Scope：本 note 拥有 `benchmarks/debug/session-throughput.bench.ts` 的工作负载、计时边界、内存端点、校准基准与排除项，按基准树「 owning Agent Note 记录这些」的规则落地。

## Problem

Task 27 需要有界性能证据：被调试程序打印大量日志、Agent 逐停翻页时，一个调试会话保持廉价——10k 控制台行与 10k 帧/变量表穿过同一个 `DapDebugBackend`，历经反复的 stop/continue 循环。仓库按归属切分这份证据：语义上限（环逐出、分页窗口、过期引用拒绝）是行为，住在包内测试；基准树只拥有时序与常驻内存证据，并拒绝把语义断言复制进基准的完成条件。

## Decision

基准通过进程内脚本化 wire（与真实适配器同一 wire 形态）驱动 `@deepseek-ai/dsh-debug-dap` 构建 `lib/` 入口里的生产 `DapDebugBackend` 与 `DapClient`——不引入任何 test-support fake。一次 launch 重放 10,000 条 output 事件；随后 25 轮 stop/continue 循环，每轮读取 20 帧的栈页、一个 scope、20 个变量的页与有界控制台环。worker 先验证各端点到达上限（环 128、页 20）再产出报告，因此每条计时线描述的都是有界面。

**工作负载。** worker 内固定合成常量：10,000 帧与 10,000 变量的 wire 表、10,000 控制台行、25 轮循环、页 20、控制台环 128。无录制会话、无工具链、无网络。

**计时边界。** `ingestMs` 覆盖 `start()` 起经 launch 握手到全部 10k output 事件；`cyclesMs` 覆盖其后的 25 轮检查-继续循环。全进程墙钟，无存储或定步等待（`ioShare: 0`）。

**内存端点。** 最后一轮后存活 backend 的常驻堆（含 worker 固定的 wire 表），预算 24 MiB。

**校准基准。** Apple M4 Pro 实测 ingest ≈ 25 ms、cycles ≈ 49 ms；预算 40 ms 与 80 ms（共享 CI 时间缩放与余量之前）。

## Alternatives considered

复用 `@deepseek-ai/dsh-fake-debug-adapter` 作驱动被拒：它的 fixture 固定为个位数条目，驱动 10k 体量意味着为一个基准扩展 test-support 面，且基准树要求走生产入口。只把上限断言复制进基准同样被拒（同一条规则的反向）——`packages/debug/debug-dap/tests/throughput.spec.ts` 拥有语义上限，基准拥有时序与内存。

## Consequences

基准保持很小（一个 worker、一个 bench 文件），且走的是 fake-adapter e2e 矩阵已语义覆盖的同一条分页路径。代价：wire 表是 worker 内手工维护的合成 DAP 形态，且常驻堆端点含这些表，24 MiB 预算覆盖的是「驱动 + backend」而非 backend 单独。
