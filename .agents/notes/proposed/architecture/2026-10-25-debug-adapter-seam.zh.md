# Agent Note: 调试适配器能力缝——DAP、执行世界与按会话控制

Status: proposed

[English](2026-10-25-debug-adapter-seam.md) | 中文

范围：本记录持有 Harness IDE 级调试能力的持久决策理由与边界判断。完整类型清单、面板列表与任务拆分在设计文档和实现计划这两份工作稿里，它们不作为仓库引用；下面的保证表述得足够完整，不依赖那两份文件也成立。相关长期契约：[架构](../../../../docs/architecture.zh.md)、[测试策略](../../../../docs/testing.zh.md)、[能力缝](../../../../docs/capability-seams.zh.md)。

## 问题

Harness 没有面向用户程序的调试器。`packages/experimental/inspector` 用 CDP 调试 Harness 自身，任何客户端表面都无法在 Agent 继续处理同一个问题的同时，持有一个停住的进程及其调用栈和变量。

这项能力要同时满足四个要求，而每一条都与 Harness 的既有规则相互拉扯：

- 一个会话，两个控制方。人点击断点与 Agent 调用工具必须观察到完全相同的状态，因此任何一方都不能持有调试器的私有副本。
- 四种语言、三种执行世界。Node/TypeScript、Python、Go、Rust/C/C++ 在 DAP 之外没有共同的调试器 API，而同一套会话必须能对接本机、SSH 和沙箱三种执行 provider。
- 调试器会在另一个进程里执行任意代码。`evaluate`、`setVariable`、`setExpression` 在目标进程内求值；`readMemory` 与 `source` 读出该进程已经持有的内容。
- 适配器是第三方二进制，各自带平台相关的许可证、校验和与系统权限要求（ptrace、`task_for_pid`）。

## 方案

**一条能力缝，DAP 只存在于一个包。** `ctx.debug` 是 Service Definition，语言 provider、`dsh-tool-debug` 与 Web/Desktop/TUI 客户端是彼此独立的角色。DAP 分帧、握手、能力投影和反向请求只存在于 `dsh-debug-dap`，归一化模型永不携带原始 DAP 请求或响应。这是一条负向保证：没有逃生口通向协议，因此权限、工作区和沙箱检查无法被懂 DAP 的调用方绕开。

**provider 只做解析，seam 负责启动。** provider 实现 `resolveLaunch`/`resolveAttach` 产出计划，不 spawn、不读文件：它收到的是携带当前组合的 `SubprocessRuntime` 与 `FileSystem` 的 `DebugEnvironment`。跟随现有执行 provider 是让本机、SSH、沙箱成为一条代码路径而非三条的关键。两个后果是有意为之且固定不变：适配器必须已存在于目标世界（不把宿主二进制复制到远端或受限世界），无法授予 `ptrace` 或 `networkListen` 的世界在启动前以 `DEBUG_SANDBOX_DENIED` 或 `DEBUG_ATTACH_UNSUPPORTED` 失败，而不是静默降级到更弱的传输。

**所有权按 Session，清理才有主人。** 每个 `launch`/`attach` 都带发起方 Session——Agent 自己的 Session，或工作台当前对话的 Session。工作区归档 admission 以 Session 为键（`workspace/session-activity` 报告、`workspace/session-stop` 终止，与现有 `turn`、`job`、`subagent`、`schedule` 家族并列）；没有 Session 归属的调试会话没有报告入口，会存活到 Host 关闭，所以 seam 直接拒绝它。

**控制授权按会话授予，不按工作区默认全开。** 被否决的备选是「一次 launch 批准后，Agent 可控制该工作区内所有会话」。控制他人创建的会话必须显式授权：工作台的按会话开关，或对该次调用的单独审批。因此被诱导的 Agent 无法对人正在调试的进程触达 `evaluate`、`setVariable`、`setExpression` 与 `writeMemory`，且每次控制都写入 `debug/control`。列出与读取会话状态仍按工作区开放，执行权限不开放。

**工具面经编排器缝 launch，带审批门。** `dsh-tool-debug` 持有这道门：先校验 launch/attach 字段（无效请求绝不发起审批），Agent 调用 fail-closed 地经过 `ctx.approval`——`DEBUG_APPROVAL_DENIED`，detail 区分主动拒绝与缺少回答者——授权调用方即将拥有的会话的控制权（调用方拥有自己创建的会话即 `owned`，Agent 与人同理；另有 `session-grant`、`single-approval`），随后委派给 `ctx.debug.launch`/`attach`，并在调用会话的日志上追加 `debug/control` 审计。耐久载荷保持固定的五字段 `DebugControlEvent` 契约（会话、actor、操作、线程/帧；见 `docs/persistence-changes/2026-10-25-debug-events.zh.md`），因此授权来源随工具结果返回而不是写入事件。Agent 的内存写入每次都请求审批；UI 发起的 launch 在 UI 内确认，不进入 Agent 审批缝。停驻通知与其 Config home 一起落在工具包上（`debugStopDelivery`、`debugMaxConsecutiveWakes`、`maxNoticeBytes`——刻意不复用 job 包的同名字段），并抑制由接收会话自己未结算的 resume 结算的停驻，因为该 resume 的结果已经送达了它。

**模型可见事实保持可重建。** 四个耐久事件（`debug/session-started`、`debug/stopped`、`debug/session-ended`、`debug/control`）携带 id、provider、模式、相对路径、行列、原因、结局与 actor。变量值、内存、环境变量值、原始 DAP 帧和 console 文本不进入模型可见范围，因此也不进日志。每个事件标记 `ignorable: true`，这正是未加载插件的 reader 能安全跳过、从而不必提升 `SESSION_FORMAT_VERSION` 的依据。瞬时句柄（`frameId`、`variablesReference`、适配器断点 id）在日志里只作审计值，重放时一律无效；DAP 的数字 id 只在 `dsh-debug-dap` 边界转换成品牌值，别处不转。

**表面只做渲染，不做调试。** Web、Desktop、CLI 消费同一套归一化状态、能力位与错误码，差异只在渲染、输入、适配器来源与通知通道。客户端不实现 DAP、不做 provider 选择、不解析 launch 参数。编辑器保存复用 `ctx.fs` 的版本守卫写（`writeText` 配 `replaceIfVersion`，冲突即 `FS_STALE_VERSION`），不再开辟第二条写入通道，于是需要审计的守卫写实现只有一份。

**适配器固定版本、校验和验证、装在目标世界。** 仓库内清单固定版本、分平台归档、SHA-256、许可证与可执行路径；安装绝不静默，执行一次握手自检，会话进行中禁止更新或卸载。用户显式覆盖命令与路径时跳过托管安装。校验和验证、DAP 协议常量、沙箱不可绕过是固定不变量，留在 `Config` 之外；所有随部署变化的上限与超时都是经过校验的 `Config` 字段。

**一份会话操作契约，端到端分派。** 工具分派、debug-controller 远端与测试消费同一份 `DebugSessionOperations` 契约——按会话经 `ctx.debug` 后端注册表解析——而不是各层各持方法子集。固定不变的后果：`memoryReference` 锚点从 `variables`、`evaluate`、`disassemble` 的结果流入 `read_memory`、`write_memory` 与 `disassemble`，不需要第二套查找面；内存读取携带适配器解析出的地址与不可读尾部，内存写入呈现适配器的部分写报告；`breakpoint_locations` 以适配器解析的源码区间合法位置补全 inspection 词汇。能力门控在实践中按 provider 拉开差距，而不只是类型层面——在实测适配器集合中（上游能力声明，2026-10：内置 vscode-js-debug 1.140.0、debugpy main pydevd 分发器、delve master DAP server、lldb-dap main），`setVariable` 全员支持，`restartFrame` 仅 vscode-js-debug，debugpy 缺内存读写，delve 缺 completions：

| 操作 | vscode-js-debug | debugpy | delve (DAP) | lldb-dap |
| --- | --- | --- | --- | --- |
| setVariable | ✓ | ✓ | ✓ | ✓ |
| restartFrame | ✓ | ✗ | ✗（无计划支持） | ✗ |
| readMemory/writeMemory | ✓ | ✗ | ✓ | ✓ |
| completions | ✓ | ✓ | ✗ | ✓ |
| breakpointLocations | ✓（根处理器可能返回 []） | ✗ | ✗ | 未验证 |

`capabilities/changed` 发射器已存在于后端层——握手后与 DAP capabilities 事件时发出；把它接入领域事件等待会话面组合（下一波），因此 UI 门控尚未在生产可用。

## 备选方案

- **托管或内嵌外部 IDE。** 否决：需求是人与 Agent 在 Harness 内共享同一会话，外部调试器持有的状态 Harness 无法投影。
- **各语言原生协议（CDP、debugpy 线协议、Delve RPC、LLDB API）。** 否决：换来四套状态机与每新增一种语言的固定成本，而换来的能力并不超出 DAP 已暴露的范围。
- **一次批准后 Agent 全权控制工作区。** 因上述爆炸半径否决；只有在产品明确接受「在人的目标进程里执行代码」时才重议。
- **跨 Host 重启恢复调试会话。** 否决：会话持有活的适配器进程与被约束的进程树，二者都是进程内资源。断点、监视表达式和命名配置持久化，会话不持久化。
- **新建 `api/workspace-edit` 包。** 评审后否决：`ctx.fs` 已持有版本化原子写与 `fs/observed`，第二条写路径只会重复那份防止编辑器保存覆盖并发修改的守卫。
- **把调试状态记进 Session 日志以供重放。** 否决：为了毫无重建收益的目标，把目标进程内存与密钥写进持久的、模型可见的历史。

## 验收标准

- 每个表面一个 keyless 录制 Session 快照，证明同一段停住、单步、终止序列在 Web、Desktop、CLI 上产出完全一致的归一化状态与错误码。
- 人启动的会话在未授权时拒绝 Agent 控制；放行与拒绝两条路径都断言 `debug/control` 里的授权来源。
- 归档一个持有运行中调试会话的 Session 时，先报告再终止；断言经由 Workspace registry 走，不是直接调用。
- 缺少所需能力的受限或远端世界在启动前返回具体错误码，且不会把宿主适配器二进制复制进去。
- 适配器安装在校验和不匹配时拒绝、不留半安装目录，并且验证开关不可配置。
- 耐久事件集合不含任何变量值、内存字节或环境变量值；测试同时断言提交的 JSONL 与 `headless --json` 输出里没有它们。
- provider 任务不向能力缝类型引入 `unknown` 或 `as never`；出现形状缺口时先改契约。

## 风险

- DAP 标准化协议但不标准化 launch 配置，差异由 provider schema 与平台矩阵承担；坚持每种语言跑真实适配器 e2e，不要只信假适配器。
- 沙箱 ptrace 与 macOS `task_for_pid` 使 attach 可用性随平台变化；在启动前报告缺失能力，而不是抛一个协议错误。
- SSH 世界可能无法下载适配器，不可回退宿主的规则把它变成带安装指引的硬失败。
- 按会话串行化叠加「适配器在 `launch` 期间发起反向请求」有死锁风险；两条已记录的例外（未结算 resume 的等待、适配器发起的反向请求）需要显式覆盖。
- Ink、ink-testing-library 与 node-pty 都是新增的面向原生的测试依赖，而 `ctx.terminals` 已提供持久终端；TUI 任务开工前必须在依赖评审里解决这个重叠。
- 约十六个新包的每文件 100% 覆盖率，叠加四语言、三世界、三表面矩阵，是 CI 的主要成本；让假适配器继续承担状态机路径的权威，真实矩阵保持精简。
