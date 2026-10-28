# Agent Note：调试适配器缝 —— DAP、执行世界与会话级控制

Status: implemented

[English](2026-10-25-debug-adapter-seam.md) | 中文

Scope：本 note 拥有 Harness IDE 级调试的持久决策依据。子系统契约、面板清单与上限住在 [docs/subsystems/debug.zh.md](../../../../docs/subsystems/debug.zh.md)；本 note 记录边界为何成立以及拒绝了什么。

## Problem

Harness 此前没有面向用户程序的调试器。调试能力必须同时满足四个诉求，而每个诉求都拉扯一条既有规则：人与 Agent 必须观察到同一份会话状态；四种语言（Node/TypeScript、Python、Go、Rust/C/C++）横跨三个执行世界（本机、SSH、沙箱），在 DAP 之外没有共同调试 API；调试器会在目标进程内执行任意代码；适配器是第三方二进制，带平台相关的许可证、校验和与系统权限。

## Decision

**一条缝，DAP 只住在一个包。** `ctx.debug` 是 Service Definition；语言 provider、`dsh-tool-debug`、Remote 控制器与 Web/Desktop/TUI 三个端是各自的角色。DAP 分帧、握手、能力投影与反向请求只存在于 `dsh-debug-dap`；归一化模型从不携带原始 DAP 请求或响应，因此没有任何后门能绕过权限、工作区与沙箱检查直达协议。

**Provider 做解析，缝做启动。** provider 把 `resolveLaunch`/`resolveAttach` 解析成计划，从不 spawn 或读文件。`DebugEnvironment` 携带组合好的 `SubprocessRuntime` 与 `FileSystem`，本机、SSH、沙箱因此是同一条代码路径。适配器必须已存在于目标世界——宿主二进制不被复制到远端或受限世界——无法授予所需能力的世界在 launch 之前以 `DEBUG_SANDBOX_DENIED` 或 `DEBUG_ATTACH_UNSUPPORTED` 失败，而不是退化到更弱的传输。

**所有权按 Session。** 每次 launch 或 attach 携带发起 Session；工作区归档准入经 Workspace 注册表报告并终止会话。无 Session 的调试启动没有报告路径，被拒绝。

**控制权按会话，不按工作区。** 控制他人创建的会话需要显式授权：会话级工作台开关，或针对该调用的一次审批。`evaluate`、`setVariable`、`setExpression` 与 `writeMemory` 对被操纵的 Agent 作用于人类正在调试的进程保持不可达，且每次控制操作写一条带授权来源的耐久 `debug/control` 事件。列举与读取会话状态保持工作区范围；执行权不是。

**模型可见事实可重建。** 四个耐久事件（`debug/session-started`、`debug/stopped`、`debug/session-ended`、`debug/control`）携带 id、provider、模式、相对源码位置、原因、结果与行为者——不再有其他内容。变量值、内存、环境值、原始帧与控制台文本不进模型可见面，也不入日志。瞬态 DAP 句柄在 `dsh-debug-dap` 边界转换为品牌 id，重放时永不有效。

**各端只渲染，不调试。** Web、Desktop 与 CLI 消费同一份归一化状态、能力位与错误码；它们不实现 DAP、不做 provider 选择、不解析 launch 参数。编辑器保存复用 `ctx.fs` 版本守卫写（冲突语义为 `FS_STALE_VERSION`），受审计的守卫写实现只有一份。

**适配器源是 `archive` 或 `pypi`，固定版本并校验。** js-debug 以 GitHub release 归档分发并带官方 digest；debugpy 从 PyPI 安装进隔离 venv，做 digest 校验、自检失败回滚。校验和验证、协议常量与沙箱不绕过是 `Config` 之外的固定不变量；随部署变化的限额与超时是验证过的 `Config` 字段。用户命令覆盖显式跳过托管安装。

**v1 组合是可选的。** `@deepseek-ai/dsh-debug-bundle` 是 `OPTIONAL_BUNDLES` 成员：经 `dsh plugin` 启用，不被任何 shipped template 选中，不进 `dsh-base`。

## Compatibility

耐久调试事件是同版本新增并携带 `ignorable: true`；未装插件的读取方跳过它们，无需提升 `SESSION_FORMAT_VERSION`。调试会话不跨 Host 重启恢复——会话拥有活跃适配器进程与受限进程树，都是进程本地资源。断点、监视表达式与命名 launch 配置跨重启保留；会话随 Host 终止。

## Alternatives considered

**宿主或内嵌外部 IDE。** 拒绝：诉求是人与 Agent 在 Harness 内共享会话；外部调试器持有 Harness 无法投影的状态。

**按语言的私有协议（CDP、debugpy 私有线协议、Delve RPC、LLDB API）。** 拒绝：四个状态机、每加一种语言一份新成本，而 DAP 已提供这些能力。

**一次审批后 Agent 控制整个工作区。** 因爆炸半径拒绝：只有接受「在人类目标进程内执行代码」的产品决策才能重开。

**跨 Host 重启恢复调试会话。** 拒绝：进程本地资源无法从日志重建；持久化限于断点、监视表达式与命名配置。

**为编辑器保存建独立的 `api/workspace-edit` 包。** 拒绝：`ctx.fs` 已拥有版本守卫的原子写；第二条写路径重复了防止编辑器保存覆写并发修改的守卫。

**把调试状态记进 Session 日志以供重放。** 拒绝：这会把目标进程内存与机密放进耐久且模型可见的历史，换不来任何重建收益。

**`npm` 适配器源类型。** 实现中移除：js-debug 的 DAP server 以 GitHub 归档分发而非 npm 包，也没有消费方需要 npm；源模型收敛为 `archive` 加 `pypi`，系统已装的适配器由显式用户覆盖承载而不进托管清单。

## Consequences

假 DAP 适配器对状态机路径保持权威，真实适配器矩阵按语言与世界校准它。缺少 `go`/`dlv`/`lldb-dap` 的机器上，对应 e2e 泳道显式 skip 并点名缺失工具链，而不是 mock 协议路径。每会话串行队列的两个例外——未决 resume/step 等待不占队列头、适配器反向请求在队列外处理——都有显式测试。新会话成本主要由首次使用的适配器安装构成；预热缓存是 CI 的既定对策。
