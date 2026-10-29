# 调试会话吞吐

[English](README.md) | 中文

在进程内脚本化线缆上测量生产 `DapDebugBackend`（`@deepseek-ai/dsh-debug-dap`）：
一次 launch 回放 10,000 条 console 输出事件，随后 25 个 stop/continue 循环
各读取一页 20 帧的调用栈、一个 scope、一页 20 个变量以及有界 console 环。
端点断言 console 环保持其配置上限（128 条）、分页保持在请求窗口内，因此
计时行始终描述一个有界表面。

- 工作负载：worker 内固定的合成常量；不使用录制的会话或工具链适配器。
- 计时边界：`ingestMs` 覆盖 `start()` 到 launch 握手与全部 10k 输出事件；
  `cyclesMs` 覆盖其后的 25 个检查-继续循环。两者均为全进程墙上时钟，
  不含存储等待。
- 内存端点：最终循环后存活 backend 的常驻堆（含 worker 固定的 10k 帧
  与变量线缆表），预算 24 MiB。
- 校准参考：Apple M4 Pro；预算通过 `ciTimeBudget` 应用共享 CI 时间
  缩放与余量。

用共享基准运行器执行：

```sh
pnpm run test:bench -t 'debug session throughput'
```

语义边界（环驱逐、分页窗口、大流量下的过期引用拒绝）由
`packages/debug/debug-dap/tests/throughput.spec.ts` 锁定；本基准只负责
计时与常驻内存证据。
