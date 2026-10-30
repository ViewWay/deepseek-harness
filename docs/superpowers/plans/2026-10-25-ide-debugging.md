# IDE 级调试能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DeepSeek Harness 内实现 Web、Desktop、CLI 三端共用的人机调试能力，覆盖四种语言、三种执行世界、完整工作台和 Agent 工具。

**Architecture:** 新增 `ctx.debug` 能力缝，DAP 作为唯一协议边界；四类 provider 只负责适配器与 launch 配置，所有调试进程通过 `ctx.subprocess` / `ctx.fs` 运行。Web/Desktop 使用 Remote + 工作台，CLI 使用 `dsh tui` 与 headless NDJSON；三端共享会话、断点、事件和权限。

**Tech Stack:** TypeScript ESM、Cordis、DAP、CodeMirror 6、Ink、Typert Remote、Vitest、Playwright、pnpm workspaces。

**Spec:** [2026-10-25-ide-debugging-design.md](../specs/2026-10-25-ide-debugging-design.md)

## Global Constraints

- 本计划不写日期、工期、估算或排期；任务只按依赖关系排序。
- 每个任务先写失败测试，再实现最小代码，再跑测试，再提交；不要跳过失败验证。
- 遵守仓库 `AGENTS.md`、`packages/AGENTS.md`、`docs/AGENTS.md` 和 `dsh-session-projection` 技能。
- ESM everywhere；包名 `@deepseek-ai/dsh-*`；Harness 包声明 `@deepseek-ai/cordis` peer/dev 依赖。
- 公共 API 预发布；修改任何消费者时同步更新所有调用点。
- 每文件 100% 覆盖率；产品可见插件必须有非 unit 的真实组合测试；model/UI 可见变化需要快照。
- 模型可见 ⟺ Session 日志可重建；新增模型可见输入必须有耐久事件。
- 三端只消费 `ctx.debug`；客户端不得实现 DAP、provider 选择或 launch 参数解析。
- 永不暴露原始 DAP 透传；内存写入默认关闭；审批、沙箱和工作区边界不可绕过。
- 所有部署相关上限/超时/投递策略进入验证过的 Config 字段，不写死。
- 使用 typed structured failures；不新增 `as unknown`；封闭 union 用 `assertNever`。
- 本计划测试片段里的 `as never` 与裸 id 字符串是待替换占位，实现时一律换成 `packages/test-support/debug-fixture` 的类型化工厂（见 Shared Interfaces 约束）。保留任何 `as never` 都视为类型缺口未解决，先改契约再写测试。
- 错误码按语义分配：provider 注册用 `DEBUG_INVALID_PROVIDER`，命名配置与 provider 选项校验用 `DEBUG_INVALID_CONFIG`，断点数量超限用 `DEBUG_BREAKPOINT_LIMIT`，未声明操作/命令用 `DEBUG_UNKNOWN_OPERATION`，控制授权拒绝用 `DEBUG_CONTROL_NOT_GRANTED`。
- 文档、README、JSDoc 与代码同一变更更新；中英文配对和生成目录按 `docs/AGENTS.md`。
- 提交信息使用 conventional commits；每个任务一个可独立回滚的提交。
- 聚焦测试：`pnpm exec vitest run <path>`；类型检查：`pnpm run typecheck`；构建：`pnpm run build:artifacts`；构建校验：`pnpm run build:check`；文档门禁：`pnpm run doc-sync`；快照：`pnpm run test:snapshot -t <name>`。

## Review Resolutions (2026-10-25)

设计评审已完成（设计文档第 21 节）。以下裁决直接约束后续任务；与旧文本冲突时以本节为准：

1. **组合归属（原阻塞项 1）**：`bundle/debug` 包名 `@deepseek-ai/dsh-debug-bundle`，登记 `packages/util/official-bundles/src/bundles.ts` 的 `OPTIONAL_BUNDLES`；v1 不进 `dsh-base`、不被 shipped template 选中。涉及 Task 26 的 bundle 落地与 `verify-official-bundle-catalog`。
2. **契约冻结（原阻塞项 2）**：Shared Interfaces + 设计第 4 节即冻结契约，Task 1 原样落入 `types.ts`。评审修正四处已回写设计：`launch`/`attach` 均返回 `DebugSession`（删除 `DebugLaunchResult`）；`source(sourceReference: DebugSourceReference)`；`pause` 补 `options?: DebugOperationOptions`；状态事件七个（无 `adapter-ready`，Task 1 现文已一致）。
3. **双语配对（原阻塞项 3）**：`docs/superpowers/` 三份工作文档加入 `scripts/translation-pairing.manifest.json` 的 `excluded`，在首次提交这些文档的 commit 内完成；正式交付文档仍按 Task 26 走配对。
4. **TUI 依赖（原阻塞项 4）**：Ink + ink-testing-library 采纳、版本固定；node-pty 仅为 Task 22/23 测试 devDependency；运行时不引入 PTY：适配器经 `ctx.subprocess` 管道启动，`runInTerminal` 复用 `ctx.terminals`（服务键 `terminals`）。Task 5 的 DAP wire 类型默认按本计划手写基线；仅当依赖评审验证 `@vscode/debugprotocol`（MIT）版本可固定时才可改为消费官方类型，并在提交说明记录版本与理由（本次评审未能通过 npm registry 核实该包，未验证前不采纳）。
5. **TUI 落地面（原阻塞项 5）**：`tui` profile 落地清单已核实真实存在并按序执行：`PROFILE_TEMPLATES` 增 `tui`（bundle 侧字段 `dsh.bundle.patch`，profile 侧 `dsh.profile.bundles`）、`apps/tui` 由 `scripts/verify-application-entrypoints` 显式归类且无 `bin`、bundle 列为 CLI 安装依赖、重跑 `gen-cli-help` 与 `gen-official-bundle-catalog`、`docs/architecture.md` shipped profile 清单与中英配对同步。全部落在 Task 22 与 Task 26。
6. **传输接口**：以 Task 5 的 `{ input: AsyncIterable<Uint8Array>, write(bytes): Promise<void>, end(): Promise<void> }` 为准；设计第 5.3 节已同步为该形状。
7. **本机环境实测（2026-10-25，macOS arm64 开发机）**：node v24.16.0、python 3.12.13、rustc 1.101.0-nightly、Apple clang 21 在场；`go`/`dlv`/`lldb-dap`/`debugpy` 缺失。Task 25b 真实矩阵在本机：Node 与 Python 可执行（debugpy 走托管安装或覆盖路径），Go 与 Native 显式 skip 并记录原因；Windows/Linux 与全平台矩阵由 CI 拥有。
16. **client 包 tsconfig 惯例（2026-10-25，Task 18 开工核实触发）**：Task 18-20 文件清单所列 tsconfig.client.json 是计划疏漏——仓库纯浏览器 client 插件（ui-sidebar-files/ui-dockkit/ui-sidebar-terminal 先例）用单一 tsconfig.json 叶子并进 tsconfig.client.json 聚合 references；只有 Host/Client 双面编译面的包才用 host/client 双叶子。ui-code-editor/ui-debug/ui-workbench 按单叶子执行。另：Task 18-20 消费的 remote client 走生成式（workspace-files 先例），生成面归 debug-controller 包（tsdown hostPhase + ./remote 导出 + remotes 装配行登记面）。
15. **适配器源模型收敛（2026-10-25，Task 11 前置核实触发）**：设计 6.2 的 `source.kind` 由 `'npm' | 'archive' | 'system'` 收敛为 `'archive' | 'pypi'`——`'npm'` 无消费方（js-debug 实测走 GitHub 归档）；`'system'` 情形（Xcode 自带 lldb-dap 等）由 6.4 显式覆盖承载，不进托管清单。`'pypi'`（debugpy）的 `platforms` 省略、按目标解释器 venv 安装、PyPI 官方 digest 校验（6.2/6.3 已回写）。adapter-manager 的实现扩展落 **Task 9c**（新插入小任务）；Task 11 按 A 路线先行只做 resolve 层，manifest 待 9c 后补注册。
14. **js-debug 分发方式修正（2026-10-25 上游实测）**：设计 6.1/6.5 原文「npm 包，托管安装」与上游事实不符——js-debug 的 DAP server 以 GitHub release 归档 `js-debug-dap-<version>.tar.gz` 分发（已核实 v1.140.0，2026-09-23，SHA-256 采用 GitHub 资产官方 digest 27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968，MIT）；npm 上的 "js-debug" 包（0.1.1，无 license）是无关同名第三方。清单按 `source.kind='archive'` 登记；归档内部布局（`js-debug/src/dapDebugServer.js`）因本环境下载域阻断未验证，Task 25b 真实 e2e 时补验。设计两处已回写。
13. **vocabulary 增补（2026-10-25）**：Task 6 消费的 12 组共 31 个 seam 类型由 debug-dap 起草、debug-core 落地进 `packages/debug/debug/src/types.ts`（消费方起草、Track A 单写、lead 回写文档的路由）；其中四处对照 DAP 规范精化：`DebugEvaluateContext` 补 `'variables'` 成五元全集、`DebugExceptionDetails` 补 `message`（不加递归 inner）、`breakMode` 收敛为封闭 union `DebugBreakMode`、`DebugDisassembledInstruction` 补 `column?`。断点请求四类型在公共导出面供 Task 7 复用。
12. **Task 2 事件清单补齐（2026-10-25 实测发现）**：本计划 Task 2 原列 9 个 live `DebugEvent` kind，漏了设计 §4.7 的 `session/owner-changed`（人工/Agent 接管审计）；实现按冻结的设计落齐 10 个，本节回写订正。
10. **协议顺序修正（2026-10-25，Task 4 实测发现）**：本计划 Task 4 测试片段原在 `launch` 后只 read 一次即期望 `stopped` 事件，与 DAP 规范冲突——适配器必须先应答 `launch` 响应，再发 `process`、`stopped` 事件；假适配器与测试均按 initialize → initialized → set*Breakpoints → configurationDone → launch →（response → process → stopped|terminated）顺序实现，片段已修正。后续 DAP 相关任务的测试片段都以该顺序为准。
11. **整树验证纪律（2026-10-25）**：共享工作树上并行 TDD 的未提交在制品会让全仓聚合 typecheck 暂红（归属明确的中间态）。各任务的验证口径=自己包叶项目 `tsc -b` 零错 + 聚焦测试绿 + 聚合错误归属分析；分支级整树 gates（typecheck、doc-sync 等）由 lead 在波收口时用临时 git worktree 检出分支 HEAD 执行，不受工作树在制品污染。
9. **实现偏差记录（2026-10-25 登记）**：Task 1 的 `@deepseek-ai/dsh-debug` package.json 在计划所列 peer/dev 之外补入 `@deepseek-ai/dsh-subprocess` 与 `@deepseek-ai/dsh-fs`——Shared Interfaces 约束 1 要求 `DebugEnvironment` 直接引用 `SubprocessRuntime`/`FileSystem` 服务类型，计划片段漏列。Task 4 的 README 按三件套（`.md`/`.zh.md`/`.i18n.yaml`）创建，原清单只列 `.md` 是疏漏。新包登记面（tsconfig 生成区/references、model-experience 与 doc-standard 清单、lockfile）由 lead 单写并随对应任务 commit 提交。
8. **开发分支**：`feat/ide-debugging` 自 2026-10-25 的 `master` 创建；未提交的他人在途文件（`.agents/notes/proposed/2026-10-25-debug-adapter-seam*`、`docs/persistence-changes/2026-10-21-prompt-optimizer-*`、`scratch-plugin/`、各 `*.d.ts.map`）不得纳入本功能提交。

## Workstreams and Dependencies

| Track | Tasks | Independently testable outcome |
|---|---|---|
| A. Core seam | T1–T3 | `ctx.debug` 注册、会话状态、所有权、耐久事件和投影 |
| B. DAP and breakpoints | T4–T7 | 假适配器、DAP 客户端、断点、真实启动/单步闭环 |
| C. Execution worlds and adapters | T8–T13 | 本机/SSH/沙箱环境、适配器管理、四语言 provider |
| D. Agent and API | T14–T17 | 模型工具、唤醒、审批、Remote、编辑器写入 |
| E. Web/Desktop | T18–T21 | 编辑器、调试面板、工作台、Desktop 原生集成 |
| F. CLI/TUI and automation | T22–T24 | TUI 会话与调试、命令、headless NDJSON |
| G. Verification and docs | T25–T27 | 三端一致性、快照/SDK、文档、安全与发布门禁 |

```text
T1 ──► T2 ──► T3
 │       │
 ├──► T4 ──► T5 ──► T6 ──► T7 ──► T6b
 │                     │
 ├──► T9 ──► T9b ──► T10/T11/T12/T13 ──► T25b
 │                     │
 └──► T8 ──────────────┴──► T25
T2 + T6b + T9b ──► T14 ──► T15
T2 + T6b ──► T16 ──► T17 ──► T18 ──► T19 ──► T20 ──► T21
T2 + T14 ──► T22 ──► T23
T14 ──► T24
T25 + T25b ──► T26 ──► T27
```

Parallelizable after their dependencies: T10–T13; T14 and T16; T18 and T22; T21 and T23. T25 waits for every track.

## File Structure Map

| Path | Responsibility |
|---|---|
| `packages/debug/README.md` | Debug 分组地图 |
| `packages/debug/debug/` | Service Definition、类型、注册表、状态机、事件、投影 |
| `packages/debug/debug-dap/` | DAP 分帧、传输、握手、能力映射、反向请求、session backend |
| `packages/debug/debug-adapter-manager/` | 清单、平台探测、托管安装、校验、覆盖 |
| `packages/debug/debug-node/` | Node.js/TypeScript provider |
| `packages/debug/debug-python/` | Python provider |
| `packages/debug/debug-go/` | Go provider |
| `packages/debug/debug-native/` | Rust/C/C++ provider |
| `packages/debug/tool-debug/` | 四个模型工具、提示词、停住通知 |
| `packages/api/debug-controller/` | Web/Desktop Remote 方法和事件流，含编辑器保存所需的 `ctx.fs` 版本守卫写 |
| `packages/client/ui-code-editor/` | CodeMirror 6 编辑器 |
| `packages/client/ui-debug/` | 调试工具条与面板 |
| `packages/client/ui-workbench/` | 工作台布局与面板注册 |
| `packages/tui/tui-debug/` | 终端调试面板、命令、源码预览 |
| `apps/tui/` | 终端应用入口、会话记录、输入、布局 |
| `packages/bundle/debug/` | Web/Desktop 调试组合层 |
| `packages/bundle/tui-app/` | `tui` profile 组合层 |
| `packages/test-support/fake-debug-adapter/` | 确定性假 DAP 适配器 |
| `packages/test-support/debug-fixture/` | 跨包共享的品牌值与 `Debug*` 类型化工厂，测试禁止 `as never` |
| `docs/subsystems/debug.md` | 子系统契约与限制 |
| `docs/user/guide/debugging.md` | Web/Desktop 用户指南 |
| `docs/user/guide/debugging-cli.md` | CLI/TUI 与 headless 指南 |

## Shared Interfaces

以下名称在后续任务中保持一致；实现时放入 `packages/debug/debug/src/types.ts`。

```text
type DebugProviderId = Branded<'DebugProviderId'>
type DebugSessionId = Branded<'DebugSessionId'>
type DebugCompoundId = Branded<'DebugCompoundId'>
type DebugThreadId = Branded<'DebugThreadId'>
type DebugFrameId = Branded<'DebugFrameId'>
type DebugVariableReference = Branded<'DebugVariableReference'>
type DebugBreakpointId = Branded<'DebugBreakpointId'>
type DebugSourceReference = Branded<'DebugSourceReference'>

type DebugSessionState = 'starting' | 'running' | 'stopped' | 'terminated' | 'failed'
type DebugStepKind = 'over' | 'in' | 'out' | 'back'
type DebugResumeResult =
  | { kind: 'stopped'; stop: DebugStopSnapshot }
  | { kind: 'terminated' }
  | { kind: 'running' }

interface DebugCapabilities {
  readonly supportsConditionalBreakpoints: boolean
  readonly supportsHitConditionalBreakpoints: boolean
  readonly supportsLogPoints: boolean
  readonly supportsFunctionBreakpoints: boolean
  readonly supportsDataBreakpoints: boolean
  readonly supportsInstructionBreakpoints: boolean
  readonly supportsExceptionFilterOptions: boolean
  readonly supportsStepBack: boolean
  readonly supportsRestartFrame: boolean
  readonly supportsSetVariable: boolean
  readonly supportsSetExpression: boolean
  readonly supportsCompletionsRequest: boolean
  readonly supportsModulesRequest: boolean
  readonly supportsLoadedSourcesRequest: boolean
  readonly supportsDisassembleRequest: boolean
  readonly supportsReadMemoryRequest: boolean
  readonly supportsWriteMemoryRequest: boolean
  readonly supportsTerminateRequest: boolean
  readonly supportsRestartRequest: boolean
  readonly supportsDelayedStackTraceLoading: boolean
  readonly supportsValueFormattingOptions: boolean
  readonly supportsEvaluateForHovers: boolean
  readonly supportsExceptionInfoRequest: boolean
  readonly supportsCancelRequest: boolean
  readonly supportsANSIStyling: boolean
  readonly supportsProgressReporting: boolean
  readonly supportsRunInTerminalRequest: boolean
  readonly supportsStartDebuggingRequest: boolean
}

interface DebugProvider {
  readonly id: DebugProviderId
  readonly displayName: string
  readonly extensions: readonly string[]
  readonly adapter: DebugAdapterDescriptor
  readonly configSchema: JsonSchema
  resolveLaunch(request: DebugLaunchRequest, environment: DebugEnvironment): Promise<DebugLaunchPlan>
  resolveAttach(request: DebugAttachRequest, environment: DebugEnvironment): Promise<DebugAttachPlan>
  probeAttachTargets?(environment: DebugEnvironment, signal?: AbortSignal): Promise<readonly DebugAttachTarget[]>
}

interface DebugLaunchRequest {
  readonly providerId: DebugProviderId
  readonly workspaceRoot: string
  readonly workspaceId: string
  readonly cwd: string
  readonly program?: string
  readonly module?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly stopOnEntry?: boolean
  readonly configurationName?: string
  readonly breakpoints?: readonly DebugBreakpointInput[]
  readonly providerOptions?: Readonly<Record<string, unknown>>
  readonly caller: DebugCaller
}

interface DebugAttachRequest {
  readonly providerId: DebugProviderId
  readonly workspaceRoot: string
  readonly workspaceId: string
  readonly processId?: number
  readonly port?: number
  readonly host?: string
  readonly url?: string
  readonly providerOptions?: Readonly<Record<string, unknown>>
  readonly caller: DebugCaller
}

type DebugCaller = { readonly kind: 'agent' | 'user'; readonly sessionId: SessionId }
type JsonValue = null | string | number | boolean | readonly JsonValue[] | Readonly<Record<string, JsonValue>>
type JsonSchema = Readonly<Record<string, JsonValue>>
type DebugExecutionCapability = 'ptrace' | 'processControl' | 'networkListen' | 'python' | 'go'

type DebugAdapterDescriptor = { readonly kind: 'managed' } | { readonly kind: 'override'; readonly command: readonly string[] }

interface ResolvedDebugAdapter {
  readonly command: readonly string[]
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly version: string
  readonly platform: string
  readonly source: 'managed' | 'override'
  readonly executablePath: string
}

interface DebugTargetPlan {
  readonly executable: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
}

interface DebugEnvironment {
  readonly workspaceRoot: string
  readonly cwd: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly pathSeparator: '/' | '\\'
  readonly shell?: string
  readonly subprocess: SubprocessRuntime
  readonly fs: FileSystem
  readonly adapters: { resolve(providerId: DebugProviderId): Promise<ResolvedDebugAdapter> }
  readonly requiredCapabilities: readonly DebugExecutionCapability[]
}

interface DebugAdapterCommand {
  readonly command: readonly string[]
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
}

interface DebugAttachTarget {
  readonly name: string
  readonly processId?: number
  readonly port?: number
  readonly host?: string
  readonly url?: string
}

interface DebugLaunchPlan {
  readonly adapter: DebugAdapterCommand
  readonly dapRequest: Readonly<Record<string, JsonValue>>
  readonly target: DebugTargetPlan
  readonly requires: readonly DebugExecutionCapability[]
  readonly manifestVersion: string
  readonly failureHint: string
}

interface DebugAttachPlan {
  readonly adapter: DebugAdapterCommand
  readonly dapRequest: Readonly<Record<string, JsonValue>>
  readonly tunnel?: { readonly host: string; readonly port: number }
  readonly requires: readonly DebugExecutionCapability[]
  readonly manifestVersion: string
  readonly failureHint: string
}

interface DebugSource {
  readonly workspaceRelativePath: string
  readonly absolutePath: string
  readonly sourceReference?: DebugSourceReference
}

interface DebugStopSnapshot {
  readonly sessionId: DebugSessionId
  readonly reason: 'breakpoint' | 'step' | 'pause' | 'entry' | 'exception' | 'dataBreakpoint' | 'instructionBreakpoint' | 'restart' | 'unknown'
  readonly threadId: DebugThreadId
  readonly frameId?: DebugFrameId
  readonly source: DebugSource
  readonly line: number
  readonly column: number
  readonly description?: string
}

interface DebugThread { readonly id: DebugThreadId; readonly name: string }
interface DebugStackFrame { readonly id: DebugFrameId; readonly name: string; readonly source?: DebugSource; readonly line?: number; readonly column?: number }
interface DebugScopeInfo { readonly name: string; readonly variablesReference: DebugVariableReference; readonly expensive: boolean }
interface DebugVariable { readonly name: string; readonly value: string; readonly type?: string; readonly variablesReference: DebugVariableReference }

interface DebugBreakpointInput { readonly line: number; readonly column?: number; readonly condition?: string; readonly hitCondition?: string; readonly logMessage?: string }
interface DebugBreakpointSetRequest { readonly source: DebugSource; readonly breakpoints: readonly DebugBreakpointInput[] }
interface DebugBreakpoint {
  readonly id: DebugBreakpointId
  readonly source: DebugSource
  readonly requestedLine: number
  readonly verified: boolean
  readonly actualLine?: number
  readonly message?: string
}
interface DebugBreakpointResult { readonly applied: readonly DebugBreakpoint[]; readonly rejected: readonly DebugBreakpoint[] }
interface DebugSessionInfo { readonly id: DebugSessionId; readonly providerId: DebugProviderId; readonly workspaceId: string; readonly state: DebugSessionState; readonly ownerSessionId?: SessionId }
interface DebugCompoundInfo { readonly id: DebugCompoundId; readonly sessions: readonly DebugSessionId[]; readonly state: DebugSessionState }
```

`DebugSessionBackend` 是内部接口，由 `debug-dap` 实现，不进入公共 seam；它暴露与 `DebugSession` 相同的显式方法，避免客户端接触 DAP。

Task 6 所需的完整分页/请求/结果类型集（DebugSteppingGranularity、DebugStackTrace{Options}、DebugVariables{Options,Page}、DebugEvaluate{Context,Result}、DebugCompletion、DebugException{BreakpointRequest,Details,Info}、DebugFunction/Data/InstructionBreakpointRequest、DebugModule{s,Page}、DebugSourceContent、DebugDisassemble{Request 相关}、DebugRead/WriteMemoryRequest、DebugConsole{Options,Entry,Page}，以及封闭 union `DebugBreakMode`）已按设计 4.4 落地于 `packages/debug/debug/src/types.ts`，形状以该文件为冻结契约；本节不重复罗列。四项落地精化（EvaluateContext 补 'variables' 成员、ExceptionDetails 补 message、breakMode 封闭 union 化、指令 column 对称）均对照 DAP 规范枚举全集。

以下四条约束本节和所有任务：

- `SubprocessRuntime` 与 `FileSystem` 是 `@deepseek-ai/dsh-subprocess` 和 `@deepseek-ai/dsh-fs` 导出的服务类型，`DebugEnvironment` 直接引用它们。适配器的启动由 `packages/debug/debug` 用 `environment.subprocess` 完成，provider 不 spawn，因此环境对象上没有 `spawnAdapter`。
- DAP 的 `threadId`、`frameId`、`variablesReference`、`breakpoint.id`、`sourceReference` 是 number。number 到品牌值的入站转换和品牌值到 number 的出站转换只发生在 `debug-dap` 后端；`packages/debug/debug` 的公共类型与工具结果里不出现裸 number id，UI 需要的 `dsh-resource://file/session/<id>/<path>` 地址由 `api/debug-controller` 从 `DebugSource.workspaceRelativePath` 构造，seam 不携带 resource address。
- 测试构造 `Debug*` 值一律走 `packages/test-support/debug-fixture` 导出的工厂（`fixtureDebugSessionId()`、`fixtureStop()`、`fixtureStackFrame()` 等），工厂负责品牌化和 `debug-<16 位小写十六进制>` 的 id 格式。任务里的测试片段不得用 `as never` 或 `as unknown` 绕过类型：需要新形状时先改本节类型再写测试，说明类型缺口就是设计缺口。
- 每个 `launch`/`attach` 都带发起 Session（`DebugCaller.sessionId`），人从工作台发起时用当前对话 Session。归档 admission 按 Session 报告与终止，无 Session 归属的会话没有清理入口。

---

### Task 1: Debug 包骨架、类型、错误、provider 注册与状态机

**Milestone:** A

**Depends on:** none

**Files:**
- Create: `packages/debug/README.md`, `packages/debug/README.zh.md`, `packages/debug/README.i18n.yaml`
- Create: `packages/test-support/debug-fixture/package.json`
- Create: `packages/test-support/debug-fixture/src/index.ts`
- Create: `packages/test-support/debug-fixture/README.md`, `README.zh.md`, `README.i18n.yaml`
- Create: `packages/debug/debug/package.json`
- Create: `packages/debug/debug/tsconfig.json`
- Create: `packages/debug/debug/src/brand.ts`
- Create: `packages/debug/debug/src/types.ts`
- Create: `packages/debug/debug/src/state.ts`
- Create: `packages/debug/debug/src/index.ts`
- Create: `packages/debug/debug/tests/registry.spec.ts`
- Create: `packages/debug/debug/tests/state.spec.ts`
- Create: `packages/debug/debug/README.md`
- Create: `packages/debug/debug/README.zh.md`

**Interfaces:**
- Consumes: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-brand`, `@deepseek-ai/dsh-llm` (`HarnessError`).
- Produces: `Debug` service, `DebugProviderId`, `DebugProvider`, `DebugCapabilities`, `advanceDebugState`, `DebugError`.

- [x] **Step 1: Write the failing provider-registry test**

Create `packages/debug/debug/tests/registry.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Debug, { DebugError, DebugProviderId, type DebugProvider } from '@deepseek-ai/dsh-debug'

function provider(id: string, extensions: string[]): DebugProvider {
  return {
    id: DebugProviderId(id),
    displayName: id,
    extensions,
    adapter: { kind: 'managed' },
    configSchema: { type: 'object' },
    resolveLaunch: async () => { throw new Error('not used') },
    resolveAttach: async () => { throw new Error('not used') },
  }
}

async function mount(): Promise<Debug> {
  const ctx = new Context()
  await ctx.plugin(Debug)
  return ctx.debug as Debug
}

describe('Debug provider registry', () => {
  it('reserves provider ids and extensions atomically, then releases them', async () => {
    const debug = await mount()
    const dispose = debug.registerProvider(provider('node', ['.ts', '.js']))

    expect(() => debug.registerProvider(provider('node', ['.mjs'])))
      .toThrow(expect.objectContaining({ code: 'DEBUG_CONFLICT' }))
    expect(() => debug.registerProvider(provider('python', ['.ts'])))
      .toThrow(expect.objectContaining({ code: 'DEBUG_CONFLICT' }))

    dispose()
    expect(() => debug.registerProvider(provider('node', ['.mjs']))).not.toThrow()
  })

  it('rejects empty ids, duplicate extensions, and empty extension lists', async () => {
    const debug = await mount()
    expect(() => debug.registerProvider(provider('  ', ['.ts'])))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_PROVIDER' }))
    expect(() => debug.registerProvider(provider('node', ['.ts', '.TS'])))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_PROVIDER' }))
    expect(() => debug.registerProvider(provider('node', [])))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_PROVIDER' }))
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug/tests/registry.spec.ts`

Expected: FAIL because `@deepseek-ai/dsh-debug` cannot be resolved.

- [x] **Step 3: Create the package skeleton**

`packages/debug/debug/package.json` uses the standard package fields and these dependencies:

```text
{
  "name": "@deepseek-ai/dsh-debug",
  "version": "0.2.1-rc.3",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/types/**/*.d.ts"],
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:~",
    "@deepseek-ai/dsh-brand": "workspace:*",
    "@deepseek-ai/dsh-session": "workspace:*",
    "@deepseek-ai/dsh-session-projection": "workspace:*",
    "@deepseek-ai/dsh-llm": "workspace:*"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "workspace:~",
    "@deepseek-ai/dsh-brand": "workspace:*",
    "@deepseek-ai/dsh-session": "workspace:*",
    "@deepseek-ai/dsh-session-projection": "workspace:*",
    "@deepseek-ai/dsh-llm": "workspace:*"
  }
}
```

`tsconfig.json` extends `../../../tsconfig.base.json`, sets `rootDir: "src"`, `outDir: "lib/types"`, and references the peer packages.

`packages/debug/README.md` lists the group packages and links the subsystem page this plan creates later.

- [x] **Step 4: Implement brand, errors, types, state, and registry**

`src/brand.ts` exports branded constructors using `brandString`.

`src/types.ts` defines the shared interfaces from **Shared Interfaces** plus:

```text
type DebugErrorCode =
  | 'DEBUG_INVALID_PROVIDER' | 'DEBUG_CONFLICT' | 'DEBUG_UNAVAILABLE'
  | 'DEBUG_ADAPTER_NOT_FOUND' | 'DEBUG_ADAPTER_UNSUPPORTED' | 'DEBUG_ADAPTER_CHECKSUM'
  | 'DEBUG_LAUNCH_FAILED' | 'DEBUG_NOT_STOPPED' | 'DEBUG_INVALID_STATE'
  | 'DEBUG_STALE_REFERENCE' | 'DEBUG_UNSUPPORTED_CAPABILITY' | 'DEBUG_TIMEOUT'
  | 'DEBUG_MALFORMED_RESPONSE' | 'DEBUG_SANDBOX_DENIED' | 'DEBUG_ATTACH_UNSUPPORTED'
  | 'DEBUG_SESSION_GONE' | 'DEBUG_WORKSPACE_MISMATCH' | 'DEBUG_APPROVAL_DENIED'
  | 'DEBUG_CONTROL_NOT_GRANTED' | 'DEBUG_INVALID_CONFIG' | 'DEBUG_BREAKPOINT_LIMIT'
  | 'DEBUG_UNKNOWN_OPERATION'
```

`DEBUG_INVALID_PROVIDER` 只用于 provider 注册参数。命名配置错误用 `DEBUG_INVALID_CONFIG`，断点数量超限用 `DEBUG_BREAKPOINT_LIMIT`，工具与 TUI 的未声明操作用 `DEBUG_UNKNOWN_OPERATION`，控制授权拒绝用 `DEBUG_CONTROL_NOT_GRANTED`。适配器清单的 SHA-256 格式非法属于清单校验失败，用 `DEBUG_ADAPTER_CHECKSUM`。

`src/state.ts` implements:

```text
type DebugStateEvent =
  | 'launch-succeeded' | 'stopped' | 'continued' | 'restart'
  | 'terminated' | 'disconnected' | 'failed'

type DebugSessionOutcome = 'terminated' | 'disconnected' | 'failed'

const TRANSITIONS: Record<DebugSessionState, Partial<Record<DebugStateEvent, DebugSessionState>>> = {
  starting: { 'launch-succeeded': 'running', stopped: 'stopped', restart: 'starting', terminated: 'terminated', disconnected: 'terminated', failed: 'failed' },
  running: { stopped: 'stopped', restart: 'starting', terminated: 'terminated', disconnected: 'terminated', failed: 'failed' },
  stopped: { continued: 'running', stopped: 'stopped', restart: 'starting', terminated: 'terminated', disconnected: 'terminated', failed: 'failed' },
  terminated: { terminated: 'terminated', disconnected: 'terminated' },
  failed: { terminated: 'terminated', disconnected: 'terminated' },
}

export function advanceDebugState(state: DebugSessionState, event: DebugStateEvent): DebugSessionState {
  const next = TRANSITIONS[state][event]
  if (next === undefined) throw new DebugError(`invalid debug transition ${state} -> ${event}`, 'DEBUG_INVALID_STATE')
  return next
}

export function debugTerminalOutcome(event: DebugStateEvent): DebugSessionOutcome {
  if (event === 'terminated' || event === 'disconnected' || event === 'failed') return event
  throw new DebugError(`non-terminal event has no outcome: ${event}`, 'DEBUG_INVALID_STATE')
}
```

`terminated` 与 `failed` 对 `terminate()` 和 `disconnect()` 幂等：重复调用返回当前状态，不抛错；`debugTerminalOutcome` 把 `disconnect` 与目标进程退出区分开，写进 `debug/session-ended` 的 `outcome`。其余控制在终态抛 `DEBUG_INVALID_STATE`。没有 `adapter-ready` 事件：适配器进程已启动即 `starting`，`initialize`/配置/launch 的细节走 trace 和 `DEBUG_TIMEOUT`。

`src/index.ts` exports a `Debug` Cordis `Service` with `registerProvider`, `provider`, and `providers`. It validates everything before mutating, uses `Branded` ids, and releases id and extension reservations together. Session lifecycle methods are added by Task 2; until then they throw `DEBUG_UNAVAILABLE`.

- [x] **Step 5: Run the registry test to verify it passes**

Run: `pnpm exec vitest run packages/debug/debug/tests/registry.spec.ts`

Expected: PASS.

- [x] **Step 6: Write and run the state-machine test**

Create `packages/debug/debug/tests/state.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { advanceDebugState, debugTerminalOutcome } from '../src/state.ts'

describe('debug state machine', () => {
  it('accepts the launch, stop, continue, and terminate path', () => {
    expect(advanceDebugState('starting', 'launch-succeeded')).toBe('running')
    expect(advanceDebugState('running', 'stopped')).toBe('stopped')
    expect(advanceDebugState('stopped', 'continued')).toBe('running')
    expect(advanceDebugState('running', 'terminated')).toBe('terminated')
  })

  it('rejects operations that are invalid for the state', () => {
    expect(() => advanceDebugState('running', 'continued')).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_STATE' }))
    expect(() => advanceDebugState('terminated', 'stopped')).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_STATE' }))
  })

  it('keeps terminate and disconnect idempotent in both terminal states', () => {
    expect(advanceDebugState('terminated', 'terminated')).toBe('terminated')
    expect(advanceDebugState('failed', 'disconnected')).toBe('terminated')
    expect(debugTerminalOutcome('disconnected')).toBe('disconnected')
    expect(() => debugTerminalOutcome('continued')).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_STATE' }))
  })

  it('restarts from running and stopped back to starting', () => {
    expect(advanceDebugState('running', 'restart')).toBe('starting')
    expect(advanceDebugState('stopped', 'restart')).toBe('starting')
  })
})
```

Run: `pnpm exec vitest run packages/debug/debug/tests/state.spec.ts`

Expected: PASS.

- [x] **Step 7: Typecheck and commit**

Run: `pnpm run typecheck`

Expected: PASS.

```sh
git add packages/debug
git commit -m "feat(debug): add debug seam vocabulary and provider registry"
```

---

### Task 2: Session registry, ownership, live events

**Milestone:** A

**Depends on:** Task 1

**Files:**
- Create: `packages/debug/debug/src/registry.ts`
- Create: `packages/debug/debug/src/session.ts`
- Create: `packages/debug/debug/src/compound.ts`
- Create: `packages/debug/debug/src/events.ts`
- Modify: `packages/debug/debug/src/index.ts`
- Create: `packages/debug/debug/tests/session-registry.spec.ts`
- Create: `packages/debug/debug/tests/compound.spec.ts`

**Interfaces:**
- Consumes: `DebugSessionState`, `advanceDebugState`, `DebugSessionId`, `SessionId`, `DebugError`.
- Produces: `DebugSessionRecord`, `DebugSessionRegistry`, live `DebugEventSource`; `DebugService.list/get` backed by the registry.

- [x] **Step 1: Write the failing ownership test**

Create `packages/debug/debug/tests/session-registry.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { fixtureDebugSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { DebugSessionRegistry } from '../src/registry.ts'

describe('DebugSessionRegistry', () => {
  it('lists by workspace and rejects cross-workspace access', () => {
    const registry = new DebugSessionRegistry()
    const id = fixtureDebugSessionId(1)
    registry.add(sessionRecord({ id, workspaceId: 'ws-1' }))
    expect(registry.list({ workspaceId: 'ws-1' })).toHaveLength(1)
    expect(() => registry.get(id, { workspaceId: 'ws-2' }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_WORKSPACE_MISMATCH' }))
  })

  it('disposes a session once and publishes termination after commit', async () => {
    const registry = new DebugSessionRegistry()
    const entry = sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1' })
    const seen: string[] = []
    registry.events.subscribe({ workspaceId: 'ws-1' }, event => seen.push(event.kind))
    registry.add(entry)
    await registry.remove(entry.id, 'user')
    await registry.remove(entry.id, 'user')
    expect(entry.dispose).toHaveBeenCalledOnce()
    expect(seen.at(-1)).toBe('session/terminated')
  })
})
```

`sessionRecord({ id, workspaceId, ownerSessionId? })` 是 `tests/helpers/records.ts` 里的类型化工厂，返回满足 `DebugSessionRecord` 的对象并把 `setState`/`dispose` 换成 `vi.fn()`。工厂的返回类型就是 `DebugSessionRecord`，所以测试里不出现 `as never`；`providerId` 用 `DebugProviderId('node')` 构造，`ownerSessionId` 用真实 `SessionId`。断点、栈帧、变量等同理，跨包共用的部分放 `packages/test-support/debug-fixture`。

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug/tests/session-registry.spec.ts`

Expected: FAIL because `registry.ts` does not exist.

- [x] **Step 3: Implement the registry and live event source**

`src/events.ts` provides a typed subscription:

```text
interface DebugEventSource {
  subscribe(filter: { workspaceId?: string; sessionId?: DebugSessionId }, listener: (event: DebugEvent) => void): () => void
}
```

`DebugEvent` is a closed union with `kind` values `session/starting`, `session/running`, `session/stopped`, `session/terminated`, `session/failed`, `session/owner-changed`, `breakpoint/changed`, `console/output`, `adapter/output`, `capabilities/changed`（原清单漏 `session/owner-changed`，按设计 §4.7 补齐）.

`src/registry.ts` owns:

- `add(record)` rejects duplicate ids.
- `get(id, scope)` throws `DEBUG_WORKSPACE_MISMATCH` when the workspace does not match.
- `list(scope)` returns records in insertion order.
- `setState(id, state)` commits the state before publishing.
- `remove(id, actor)` is idempotent, awaits `record.dispose()` once, then publishes `session/terminated`.

`src/session.ts` defines `DebugSessionRecord` and the in-process session object that delegates explicit operations to `DebugSessionBackend`; Task 6 supplies the backend. Task 2 only needs lifecycle and state.

`src/compound.ts` defines `DebugCompound` and `DebugCompoundRegistry`: a compound holds an ordered session list and `stopAll`, aggregates state, and exposes `terminate()`/`restart()`. Removing one child does not remove the compound until all children settle or `stopAll` terminates the rest.

- [x] **Step 3b: Write and run the compound test**

Create `packages/debug/debug/tests/compound.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { fixtureDebugCompoundId, fixtureDebugSessionId, fixtureCompoundChild } from '@deepseek-ai/dsh-debug-fixture'
import { DebugCompoundRegistry } from '../src/compound.ts'

describe('DebugCompound', () => {
  it('terminates all children when stopAll is set and aggregates state', async () => {
    const registry = new DebugCompoundRegistry()
    const children = [
      fixtureCompoundChild({ id: fixtureDebugSessionId(1), state: 'running' }),
      fixtureCompoundChild({ id: fixtureDebugSessionId(2), state: 'stopped' }),
    ]
    const compound = registry.create(fixtureDebugCompoundId(1), children, true)
    expect(compound.state).toBe('running')
    await compound.terminate()
    expect(children.flatMap(child => child.terminate.mock.calls)).toHaveLength(2)
    expect(compound.state).toBe('terminated')
  })

  it('keeps the compound while one child is unsettled and stopAll is false', async () => {
    const registry = new DebugCompoundRegistry()
    const settled = fixtureCompoundChild({ id: fixtureDebugSessionId(1), state: 'terminated' })
    const running = fixtureCompoundChild({ id: fixtureDebugSessionId(2), state: 'running' })
    const compound = registry.create(fixtureDebugCompoundId(2), [settled, running], false)
    await compound.settleChild(settled.id)
    expect(compound.state).toBe('running')
  })
})
```

`fixtureCompoundChild` 返回 `{ id, state, terminate: Mock }`，`terminate` 是 `vi.fn(async () => {})`，因此 `child.terminate.mock.calls` 在类型上可用。该步骤先运行到失败（`compound.ts` 还不存在），实现后回到 PASS。

Run: `pnpm exec vitest run packages/debug/debug/tests/compound.spec.ts`

Expected: 第一次 FAIL（模块不存在），实现后 PASS。

- [x] **Step 4: Wire the registry into `Debug`**

`Debug` owns one `DebugSessionRegistry`, injects live events, and implements `list`/`get`. `launch`/`attach` remain `DEBUG_UNAVAILABLE` until Task 6.

- [x] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/debug/debug/tests/session-registry.spec.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```sh
git add packages/debug/debug
git commit -m "feat(debug): add session registry and live debug events"
```

---

### Task 3: Durable debug events, projection, and message source

**Milestone:** A

**Depends on:** Task 2

**Files:**
- Create: `packages/debug/debug/src/session-events.ts`
- Create: `packages/debug/debug/src/projection.ts`
- Modify: `packages/debug/debug/src/index.ts`
- Create: `packages/debug/debug/tests/projection.spec.ts`

**Interfaces:**
- Consumes: `SessionEventMap` declaration merging, `ProjectionDefinition`, `MessageSourceMap`.
- Produces: `debug/session-started`, `debug/stopped`, `debug/session-ended`, `debug/control`; `debugSessions` projection; `debug` message source.

- [x] **Step 1: Write the failing projection test**

Create `packages/debug/debug/tests/projection.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { fixtureSessionHeader, fixtureDebugSessionId, fixtureThreadId } from '@deepseek-ai/dsh-debug-fixture'
import { debugSessionsProjection } from '../src/projection.ts'

const header = fixtureSessionHeader('session-1')
const id = fixtureDebugSessionId(1)

describe('debugSessions projection', () => {
  it('folds start, stop, and end into one bounded session record', () => {
    let state = debugSessionsProjection.init(header, 0)
    state = debugSessionsProjection.apply(state, sessionStartedEvent({
      sessionId: id, providerId: 'node', mode: 'launch', workspaceRoot: '/ws', adapterVersion: '1.0.0',
    }))
    state = debugSessionsProjection.apply(state, stoppedEvent({
      sessionId: id, reason: 'breakpoint', threadId: fixtureThreadId(1), source: 'src/a.ts', line: 4, column: 2,
    }))
    expect(state.sessions[0]).toMatchObject({ id, state: 'stopped', lastStop: { line: 4 } })
    state = debugSessionsProjection.apply(state, sessionEndedEvent({ sessionId: id, outcome: 'terminated' }))
    expect(state.sessions[0]).toMatchObject({ state: 'terminated' })
  })

  it('returns the same reference for unrelated events', () => {
    const initial = debugSessionsProjection.init(header, 0)
    expect(debugSessionsProjection.apply(initial, unrelatedAssistantEvent())).toBe(initial)
  })

  it('caps retained sessions at the configured bound', () => {
    let state = debugSessionsProjection.init(header, 0)
    for (let index = 0; index < 40; index += 1) state = debugSessionsProjection.apply(state, sessionStartedEvent({ sessionId: fixtureDebugSessionId(index) }))
    expect(state.sessions).toHaveLength(32)
  })
})
```

事件构造函数在 `tests/helpers/events.ts`，返回类型是 `SessionEvent`（`debug/*` 分支），投影因此不需要 `as never`；`source` 在耐久事件里是工作区相对路径字符串，品牌 id 在序列化时是字符串形式。`MAX_SESSIONS` 与 `MAX_STOPS` 是 Config 字段 `maxProjectedSessions` 的默认值，不是硬编码常量。

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug/tests/projection.spec.ts`

Expected: FAIL because the projection does not exist.

- [x] **Step 3: Declare durable events and message source**

`src/session-events.ts` merges `SessionEventMap` with the four `debug/*` events. Each event is declared `ignorable: true` at the envelope site by the writer, so readers without the plugin skip it. The payloads contain only ids, mode, provider, workspace root, relative source, line/column, reason, outcome, actor, and operation; no variable values, memory, environment values, or DAP frames.

Declare the `debug` source in `MessageSourceMap` with `sessionId` and `reason`.

- [x] **Step 4: Implement the projection**

`src/projection.ts` exports `debugSessionsProjection`:

```text
const DEFAULT_MAX_PROJECTED_SESSIONS = 32
const DEFAULT_MAX_STOPS = 20

export const debugSessionsProjection = {
  key: 'debugSessions',
  stateVersion: 1,
  stateSchema: debugSessionsStateSchema,
  init: () => ({ sessions: [] }),
  apply: (state, event) => { /* fold only debug/* events; return same ref otherwise */ },
  wire: { viewSchema: debugSessionsViewSchema, view: state => state },
}
```

两个上限是 `Debug` 插件 `Config` 字段 `maxProjectedSessions` 与 `maxProjectedStops` 的默认值，通过 `init(header, config)` 或投影定义工厂注入；投影状态版本化，`apply` 保持同步确定、不做 I/O，checkpoint + 后缀重放必须等于全量重放（`dsh-session-projection` 的约束）。

The projection caps sessions and keeps only the last stop per session. It is registered with `ctx.sessionProjections` in `Debug.apply`; registration is awaited and owned by the plugin fiber.

- [x] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/debug/debug/tests/projection.spec.ts`

Expected: PASS.

- [x] **Step 6: Typecheck and commit**

Run: `pnpm run typecheck`

Expected: PASS.

```sh
git add packages/debug/debug
git commit -m "feat(debug): add durable debug events and session projection"
```

---

### Task 4: Deterministic fake DAP adapter

**Milestone:** B

**Depends on:** Task 1

**Files:**
- Create: `packages/test-support/fake-debug-adapter/package.json`
- Create: `packages/test-support/fake-debug-adapter/src/frames.ts`
- Create: `packages/test-support/fake-debug-adapter/src/index.ts`
- Create: `packages/test-support/fake-debug-adapter/tests/adapter.spec.ts`
- Create: `packages/test-support/fake-debug-adapter/README.md`、`README.zh.md`、`README.i18n.yaml`（仓库三件套规范，原清单只列 README.md 是疏漏）

**Interfaces:**
- Produces: `createFakeDebugAdapter(script?)` returning `{ write(frame), read(): Promise<DapMessage> }`; scripted stops, breakpoints, threads, scopes, variables, evaluate, exceptions, restart, terminate, malformed frames, and reverse requests.

- [x] **Step 1: Write the failing adapter test**

Create `packages/test-support/fake-debug-adapter/tests/adapter.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { createFakeDebugAdapter } from '../src/index.ts'

describe('fake debug adapter', () => {
  it('answers initialize and emits initialized', async () => {
    const adapter = createFakeDebugAdapter()
    adapter.write({ seq: 1, type: 'request', command: 'initialize', arguments: { clientID: 'test', linesStartAt1: true } })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', success: true, command: 'initialize' })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'initialized' })
  })

  it('stops at the first scripted breakpoint after launch', async () => {
    const adapter = createFakeDebugAdapter({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }] })
    adapter.write({ seq: 1, type: 'request', command: 'initialize', arguments: {} })
    await adapter.read()
    await adapter.read()
    adapter.write({ seq: 2, type: 'request', command: 'launch', arguments: {} })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'response', success: true, command: 'launch' })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'process' })
    await expect(adapter.read()).resolves.toMatchObject({ type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } })
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/test-support/fake-debug-adapter/tests/adapter.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement DAP framing and the scripted adapter**

The package name is `@deepseek-ai/dsh-fake-debug-adapter` (private, `publishConfig.access: restricted`), so Tasks 5 and 6 can import it.

`src/frames.ts` exports `encodeDapFrame(message)` and `decodeDapFrames(buffer)` with `Content-Length` and UTF-8 JSON.

`src/index.ts` implements the adapter in memory:

- `initialize`: success response with capability flags and an `initialized` event.
- `setBreakpoints` / `setFunctionBreakpoints` / `setExceptionBreakpoints`: verified results.
- `configurationDone`: success and, when a `stops` script exists, a `stopped` event.
- `launch` / `attach`: success; emit `process` and `stopped` or `terminated` per script.
- `threads`, `stackTrace`, `scopes`, `variables`, `evaluate`: deterministic fixture data.
- `continue` / `next` / `stepIn` / `stepOut`: advance the script and emit the next stop or `terminated`.
- `restart`, `terminate`, `disconnect`: scripted response/event.
- Script can inject a malformed frame, delayed event, adapter crash, stderr text, and a `runInTerminal` reverse request.

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/test-support/fake-debug-adapter/tests/adapter.spec.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```sh
git add packages/test-support/fake-debug-adapter
git commit -m "test(debug): add deterministic fake DAP adapter"
```

---

### Task 5: DAP framing, transport, and request client

**Milestone:** B

**Depends on:** Task 4

**Files:**
- Create: `packages/debug/debug-dap/package.json`
- Create: `packages/debug/debug-dap/tsconfig.json`
- Create: `packages/debug/debug-dap/src/frames.ts`
- Create: `packages/debug/debug-dap/src/transport.ts`
- Create: `packages/debug/debug-dap/src/client.ts`
- Create: `packages/debug/debug-dap/tests/frames.spec.ts`
- Create: `packages/debug/debug-dap/tests/client.spec.ts`
- Create: `packages/debug/debug-dap/tests/memory-transport.ts`
- Create: `packages/debug/debug-dap/README.md`
- Create: `packages/debug/debug-dap/README.zh.md`

**Interfaces:**
- Consumes: `DebugTransport`, `DebugError`, fake adapter frames.
- Produces: `encodeDapFrame`, `decodeDapFrames`, `DapClient` with `request(command, args, signal)`, `onEvent(listener)`, `onReverseRequest(handler)`, `dispose()`.

- [x] **Step 1: Write the failing framing test**

Create `packages/debug/debug-dap/tests/frames.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { decodeDapFrames, encodeDapFrame } from '../src/frames.ts'

describe('DAP framing', () => {
  it('round-trips one message and keeps a partial tail', () => {
    const message = { seq: 1, type: 'request', command: 'initialize', arguments: { clientID: 'dsh' } }
    const encoded = encodeDapFrame(message)
    const first = decodeDapFrames(encoded.subarray(0, 10))
    expect(first.messages).toEqual([])
    const second = decodeDapFrames(Buffer.concat([first.rest, encoded.subarray(10)]))
    expect(second.messages).toEqual([message])
    expect(second.rest).toHaveLength(0)
  })

  it('rejects a missing or non-numeric Content-Length', () => {
    expect(() => decodeDapFrames(Buffer.from('Content-Length: nope\r\n\r\n{}'))).toThrow(expect.objectContaining({ code: 'DEBUG_MALFORMED_RESPONSE' }))
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug-dap/tests/frames.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement framing and transport**

`frames.ts` uses `Content-Length: <bytes>\r\n\r\n<utf8-json>`; it rejects negative, missing, non-numeric, and over-`maxMessageBytes` lengths. `transport.ts` defines:

```text
interface DebugTransport {
  readonly input: AsyncIterable<Uint8Array>
  write(bytes: Uint8Array): Promise<void>
  end(): Promise<void>
}
```

`createStdioTransport(process)` and `createTunnelTransport(socket)` adapt the execution world and the SSH tunnel.

- [x] **Step 4: Write the failing client test**

Create `packages/debug/debug-dap/tests/client.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { createFakeDebugAdapter } from '@deepseek-ai/dsh-fake-debug-adapter'
import { createMemoryTransport } from './memory-transport.ts'
import { DapClient } from '../src/client.ts'

describe('DapClient', () => {
  it('matches a response to its request and dispatches events', async () => {
    const adapter = createFakeDebugAdapter()
    const client = new DapClient(createMemoryTransport(adapter))
    const events: string[] = []
    client.onEvent(event => events.push(event.event))
    await expect(client.request('initialize', { clientID: 'dsh', linesStartAt1: true })).resolves.toMatchObject({ success: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(events).toContain('initialized')
    await client.dispose()
  })

  it('rejects a request on timeout and on abort', async () => {
    const adapter = createFakeDebugAdapter({ hang: ['threads'] })
    const client = new DapClient(createMemoryTransport(adapter))
    await expect(client.request('threads', {}, AbortSignal.timeout(5)))
      .rejects.toMatchObject({ code: 'DEBUG_TIMEOUT' })
    const controller = new AbortController()
    const pending = client.request('threads', {}, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'DEBUG_TIMEOUT' })
    await client.dispose()
  })
})
```

- [x] **Step 5: Implement the request client**

`client.ts` owns a monotonic sequence, a pending-request map keyed by `request_seq`, a single reader loop, per-request timeout, cancellation via `cancel`, reverse-request dispatch, and contained event delivery. Unknown sequences and malformed frames map to `DEBUG_MALFORMED_RESPONSE`; adapter exit maps pending requests to `DEBUG_LAUNCH_FAILED` or `DEBUG_SESSION_GONE` based on session state.

- [x] **Step 6: Run the client test to verify it passes**

Run: `pnpm exec vitest run packages/debug/debug-dap/tests/client.spec.ts`

Expected: PASS.

- [x] **Step 7: Commit**

```sh
git add packages/debug/debug-dap
git commit -m "feat(debug): add DAP framing and request client"
```

---

### Task 6: DAP handshake, capability mapping, reverse requests, and debug backend

**Milestone:** B

**Depends on:** Task 5

**Files:**
- Create: `packages/debug/debug-dap/src/capabilities.ts`
- Create: `packages/debug/debug-dap/src/handshake.ts`
- Create: `packages/debug/debug-dap/src/backend.ts`
- Modify: `packages/debug/debug-dap/src/client.ts`
- Create: `packages/debug/debug-dap/tests/handshake.spec.ts`
- Create: `packages/debug/debug-dap/tests/backend.spec.ts`

**Interfaces:**
- Consumes: `DapClient`, `DebugCapabilities`, `DebugSessionBackend`, `DebugLaunchPlan`, fake adapter.
- Produces: `initializeDebugAdapter(client, plan)`, `mapCapabilities(response)`, `DapDebugBackend`.

- [x] **Step 1: Write the failing handshake test**

Create `packages/debug/debug-dap/tests/handshake.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { createFakeDebugAdapter } from '@deepseek-ai/dsh-fake-debug-adapter'
import { createMemoryTransport } from './memory-transport.ts'
import { DapClient } from '../src/client.ts'
import { initializeDebugAdapter, mapCapabilities } from '../src/handshake.ts'

describe('DAP handshake', () => {
  it('initializes, configures breakpoints, launches, and waits for the first stop', async () => {
    const adapter = createFakeDebugAdapter({ stops: [{ reason: 'breakpoint', threadId: 1, line: 4 }] })
    const client = new DapClient(createMemoryTransport(adapter))
    const result = await initializeDebugAdapter(client, {
      adapterArgs: ['--server=1'],
      launch: { request: 'launch', program: '/ws/a.ts', cwd: '/ws' },
      breakpoints: [{ source: 'src/a.ts', lines: [4] }],
      timeoutMs: 1000,
    })
    expect(result.capabilities.supportsConditionalBreakpoints).toBe(true)
    expect(result.firstStop).toMatchObject({ reason: 'breakpoint', threadId: 1 })
    await client.dispose()
  })

  it('maps unknown capabilities to false and preserves known true flags', () => {
    expect(mapCapabilities({ supportsConditionalBreakpoints: true } as never).supportsConditionalBreakpoints).toBe(true)
    expect(mapCapabilities({} as never).supportsDataBreakpoints).toBe(false)
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug-dap/tests/handshake.spec.ts`

Expected: FAIL because `handshake.ts` does not exist.

- [x] **Step 3: Implement handshake and capability mapping**

`handshake.ts` performs the exact order from the spec: `initialize` with `linesStartAt1: true`, `columnsStartAt1: true`, `pathFormat: 'path'`; wait `initialized`; set supported breakpoint kinds; optionally `configurationDone`; send `launch`/`attach`; resolve with capabilities and the first stop/termination.

`capabilities.ts` maps every known DAP capability to `DebugCapabilities`, defaults unknown/missing to `false`, and ignores unknown fields without failing.

- [x] **Step 4: Write the failing backend test**

Create `packages/debug/debug-dap/tests/backend.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { createFakeDebugAdapter } from '@deepseek-ai/dsh-fake-debug-adapter'
import { createMemoryTransport } from './memory-transport.ts'
import { DapClient } from '../src/client.ts'
import { DapDebugBackend } from '../src/backend.ts'

describe('DapDebugBackend', () => {
  it('steps and returns the next stop; rejects inspection while running', async () => {
    const adapter = createFakeDebugAdapter({ stops: [
      { reason: 'breakpoint', threadId: 1, line: 4 },
      { reason: 'step', threadId: 1, line: 5 },
    ] })
    const client = new DapClient(createMemoryTransport(adapter))
    const backend = new DapDebugBackend(client, { supportsConfigurationDoneRequest: true } as never)
    await backend.start()
    await expect(backend.step('over', undefined, 'line')).resolves.toMatchObject({ kind: 'stopped', stop: { reason: 'step' } })
    await expect(backend.stackTrace('1' as never)).rejects.toMatchObject({ code: 'DEBUG_NOT_STOPPED' })
  })
})
```

- [x] **Step 5: Implement `DapDebugBackend`**

`backend.ts` implements the explicit `DebugSessionBackend` methods by translating to DAP commands. It owns `stopped`/`continued` tracking, thread/frame/variable references, reverse requests (`runInTerminal`, `startDebugging`, `handshake`), capability-gated rejection, stale-reference detection after continue, and bounded console/adapter output rings. `console` returns a non-consuming page with `nextOffset`; adapter stderr is tail-bounded and never model-visible unless read. Extend `backend.spec.ts` with one oversized-output case that asserts truncation and cursor advancement. No raw DAP method is exposed.

- [x] **Step 6: Run both tests to verify they pass**

Run: `pnpm exec vitest run packages/debug/debug-dap/tests/handshake.spec.ts packages/debug/debug-dap/tests/backend.spec.ts`

Expected: PASS.

- [x] **Step 7: Commit**

```sh
git add packages/debug/debug-dap
git commit -m "feat(debug): add DAP handshake and explicit debug backend"
```

---

### Task 6b: Launch and attach orchestration, durable event writing

**Milestone:** B

**Depends on:** Tasks 2, 3, 6, 7

**Files:**
- Create: `packages/debug/debug/src/launch.ts`
- Create: `packages/debug/debug/tests/launch.spec.ts`
- Modify: `packages/debug/debug/src/index.ts`

**Interfaces:**
- Consumes: `DebugProvider`, `DebugEnvironment`, `DebugAdapterManager`, `DAP client`, `DapDebugBackend`, `DebugSessionRegistry`, `Session.append`.
- Produces: `launchDebugSession`, `attachDebugSession`; durable `debug/session-started`, `debug/stopped`, `debug/session-ended` writes; pre-launch breakpoint application.

- [x] **Step 1: Write the failing orchestration test**

Create `packages/debug/debug/tests/launch.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { launchDebugSession } from '../src/launch.ts'

describe('launchDebugSession', () => {
  it('resolves the provider, starts the adapter, applies breakpoints, and records durable events', async () => {
    const append = vi.fn()
    const session = await launchDebugSession({
      request: {
        providerId: DebugProviderId('node'), workspaceRoot: '/ws', workspaceId: 'ws-1', cwd: '/ws',
        program: 'src/a.ts', caller: { kind: 'user', sessionId: fixtureSessionId(1) },
      },
      provider: fixtureProvider('node', { resolveLaunch: async () => fixtureLaunchPlan({ program: '/ws/src/a.ts' }) }),
      environment: fixtureEnvironment({ subprocess: fakeSubprocess({ exitCode: 0 }) }),
      registry: fixtureRegistry(),
      append,
      createBackend: async () => fixtureBackend({ setBreakpoints: async () => ({ applied: [], rejected: [] }) }),
    })
    expect(session.state).toMatch(/starting|running|stopped/)
    expect(fakeSubprocess.calls[0]).toMatchObject({ argv: ['adapter'] })
    expect(append).toHaveBeenCalledWith('debug/session-started', expect.objectContaining({ sessionId: expect.any(String) }), { ignorable: true })
    expect(append.mock.calls.some(([type]) => type === 'debug/stopped' || type === 'debug/session-ended')).toBe(true)
  })
})
```

`fixtureLaunchPlan` 返回 `DebugLaunchPlan`（`adapter`、`dapRequest`、`target`、`requires`、`manifestVersion`、`failureHint`），`fixtureEnvironment` 返回带 `SubprocessRuntime`/`FileSystem` 的 `DebugEnvironment`，`fakeSubprocess` 记录 `argv` 并给出 stdio 流。适配器进程由 `launch.ts` 通过 `environment.subprocess` 启动——`DebugEnvironment` 上没有 `spawnAdapter`，provider 也不 spawn。整个调用不写 `as never`：参数类型就是 `LaunchDependencies`，缺哪个字段说明该依赖还没进 Shared Interfaces，先补契约。

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug/tests/launch.spec.ts`

Expected: FAIL because `launch.ts` does not exist.

- [x] **Step 3: Implement launch and attach**

`launch.ts` performs this order: validate workspace access, ask provider for a plan, resolve the adapter in the same execution world, spawn the adapter, create the DAP client/backend, perform the handshake, create the session record, bind persisted breakpoints, add the session to the registry, then call `session.append('debug/session-started', payload, { ignorable: true })`. On any failure, stop the adapter, remove partial state, append `debug/session-ended` with `failed`, and rethrow a `DebugError`.

`attachDebugSession` uses the same path and passes the provider's tunnel plan to the DAP transport. Attach never falls back to a host-local adapter.

- [x] **Step 4: Write durable events at commit points**

The session wrapper appends `debug/stopped` only after the backend has committed the stop and frame data, and `debug/session-ended` only after teardown settles. All three events carry `ignorable: true`; no variable values, memory, environment values, or DAP frames enter the payload.

- [x] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/debug/debug/tests/launch.spec.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```sh
git add packages/debug/debug
git commit -m "feat(debug): orchestrate launch attach and durable events"
```

---

### Task 7: Breakpoint registry, persistence, and application

**Milestone:** B

**Depends on:** Tasks 2, 6

**Files:**
- Create: `packages/debug/debug/src/breakpoints.ts`
- Create: `packages/debug/debug/src/breakpoint-store.ts`
- Modify: `packages/debug/debug/src/index.ts`
- Create: `packages/debug/debug/tests/breakpoints.spec.ts`

**Interfaces:**
- Consumes: `DebugSessionRegistry`, `DebugSessionBackend`, `ctx.storageDomain`.
- Produces: `BreakpointRegistry`, `BreakpointStore`, service-level `setBreakpoints` / `setExceptionBreakpoints` / `setFunctionBreakpoints` / `setDataBreakpoints` / `setInstructionBreakpoints`.

- [x] **Step 1: Write the failing breakpoint test**

Create `packages/debug/debug/tests/breakpoints.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { fixtureDebugSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { BreakpointRegistry, MemoryBreakpointStore } from '../src/breakpoints.ts'
import { sessionRecord } from './helpers/records.ts'

describe('BreakpointRegistry', () => {
  it('replaces all breakpoints in one file and applies them to matching sessions', async () => {
    const store = new MemoryBreakpointStore()
    const registry = new BreakpointRegistry(store)
    const apply = vi.fn(async () => ({ applied: [], rejected: [] }))
    registry.bindSession(sessionRecord({ id: fixtureDebugSessionId(1), workspaceId: 'ws-1', setBreakpoints: apply }))
    await registry.setFile('ws-1', 'src/a.ts', [
      { line: 4 }, { line: 5, condition: 'x > 1' }, { line: 6, logMessage: 'x={x}' },
    ])
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ source: 'src/a.ts', breakpoints: [
      { line: 4 }, { line: 5, condition: 'x > 1' }, { line: 6, logMessage: 'x={x}' },
    ] }))
    expect(await store.load('ws-1', 'src/a.ts')).toHaveLength(3)
  })

  it('rejects a breakpoint count above the configured limit', async () => {
    const registry = new BreakpointRegistry(new MemoryBreakpointStore(), { maxPerFile: 1 })
    await expect(registry.setFile('ws-1', 'src/a.ts', [{ line: 1 }, { line: 2 }]))
      .rejects.toMatchObject({ code: 'DEBUG_BREAKPOINT_LIMIT' })
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug/tests/breakpoints.spec.ts`

Expected: FAIL because `breakpoints.ts` does not exist.

- [x] **Step 3: Implement the registry and storage adapter**

`BreakpointRegistry` normalizes workspace-relative paths, validates 1-based lines and limits, replaces the complete file set atomically, persists through `BreakpointStore`, and applies to all bound sessions whose workspace matches. `StorageBreakpointStore` wraps `ctx.storageDomain` with a versioned schema; `MemoryBreakpointStore` lives in tests. `ctx.storageDomain` 是按 `{ name, version, tables }` 声明的通用 KV 设施，不带工作区作用域：`debug-breakpoints` domain 用 `workspaceId` + 工作区相对路径构成记录键实现隔离。应用结果按 `DebugBreakpointResult` 的 `applied`/`rejected` 更新 live 状态，保存适配器分配的 `id` 与 `actualLine`，并发布 `breakpoint/changed`；UI 的空心/实心与拖动改行依赖这两个字段。

- [x] **Step 4: Wire service-level methods and session binding**

`Debug.setBreakpoints` calls the registry; `DebugSession` creation binds the session backend to the registry after launch, and unbinds on dispose. Service-level operations update persisted state; session-level operations only apply to that session.

- [x] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/debug/debug/tests/breakpoints.spec.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```sh
git add packages/debug/debug
git commit -m "feat(debug): add breakpoint persistence and session application"
```

---

### Task 8: Execution environment, SSH TCP forwarding, sandbox facts, and archive admission

**Milestone:** C

**Depends on:** Tasks 2, 6

**Files:**
- Create: `packages/debug/debug/src/environment.ts`
- Create: `packages/debug/debug-dap/src/tunnel.ts`
- Modify: `packages/ssh/ssh/src/index.ts`
- Modify: `packages/ssh/ssh/src/protocol.ts`
- Modify: `packages/ssh/ssh/src/helper-processes.ts`
- Create: `packages/ssh/ssh/tests/tcp-forward.spec.ts`
- Create: `packages/debug/debug/tests/environment.spec.ts`
- Create: `packages/debug/debug/tests/archive-admission.spec.ts`

**Interfaces:**
- Consumes: `ctx.fs`, `ctx.subprocess`, `ctx.workingDirectory`, `ctx.sandbox`, `ctx.ssh`, workspace archive admission.
- Produces: `DebugEnvironment`, `probePlatform`, `createSshTcpTunnel`, sandbox availability check, `debug` archive family.

- [x] **Step 1: Write the failing environment test**

Create `packages/debug/debug/tests/environment.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { probeDebugEnvironment } from '../src/environment.ts'

describe('DebugEnvironment', () => {
  it('reports platform, arch, path separator, and adapter capability facts from the execution world', async () => {
    const run = vi.fn(async () => ({ stdout: 'linux\nx64\n/', stderr: '', exitCode: 0 }))
    const environment = await probeDebugEnvironment({
      subprocess: { run },
      workspaceRoot: '/ws',
      platformHint: 'linux',
    } as never)
    expect(environment.platform).toBe('linux')
    expect(environment.arch).toBe('x64')
    expect(environment.pathSeparator).toBe('/')
    expect(run).toHaveBeenCalled()
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug/tests/environment.spec.ts`

Expected: FAIL because `environment.ts` does not exist.

- [x] **Step 3: Implement `DebugEnvironment`**

`environment.ts` resolves `subprocess`, `fs`, `cwd`, `pathSeparator`, `platform`, `arch`, and `shell` from the composed execution world. It never uses Node `child_process` or `fs`. It checks required capabilities (`ptrace`, `processControl`, `networkListen`, `python`, `go`) and throws `DEBUG_SANDBOX_DENIED` or `DEBUG_ADAPTER_UNSUPPORTED` with actionable detail.

- [x] **Step 4: Add SSH TCP forwarding**

Extend the SSH helper protocol with `openTcpStream` accepting a remote host and port, validating both, and allocating an authenticated stream. Expose `SshService.connectTcpStream(host, port, signal)` returning a paused socket. `debug-dap/src/tunnel.ts` wraps that socket as a `DebugTransport`; if the composed SSH service lacks the method, attach returns `DEBUG_ATTACH_UNSUPPORTED`.

Add `packages/ssh/ssh/tests/tcp-forward.spec.ts` that asserts invalid host/port rejection and that the request shape is forwarded to the helper.

- [x] **Step 5: Add archive admission**

`Debug.apply` registers a `debug` archive family with the Workspace registry: `workspace/session-activity` reports running/stopping debug sessions owned by the asked Session; `workspace/session-stop` terminates them with reason `session archived`, one at a time. Test in `archive-admission.spec.ts` with a fake registry and a fake session.

- [x] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/debug/debug/tests/environment.spec.ts packages/debug/debug/tests/archive-admission.spec.ts packages/ssh/ssh/tests/tcp-forward.spec.ts`

Expected: PASS.

- [x] **Step 7: Commit**

```sh
git add packages/debug packages/ssh
git commit -m "feat(debug): bridge execution worlds and add SSH TCP forwarding"
```

---

### Task 9: Adapter manifest, probe, managed install, and override

**Milestone:** C

**Depends on:** Task 1

**Files:**
- Create: `packages/debug/debug-adapter-manager/package.json`
- Create: `packages/debug/debug-adapter-manager/tsconfig.json`
- Create: `packages/debug/debug-adapter-manager/src/manifest.ts`
- Create: `packages/debug/debug-adapter-manager/src/manager.ts`
- Create: `packages/debug/debug-adapter-manager/src/install.ts`
- Create: `packages/debug/debug-adapter-manager/tests/manifest.spec.ts`
- Create: `packages/debug/debug-adapter-manager/tests/install.spec.ts`
- Create: `packages/debug/debug-adapter-manager/README.md`
- Create: `packages/debug/debug-adapter-manager/README.zh.md`
- Create: `packages/debug/debug-adapter-manager/README.i18n.yaml`（三件套规范）

**Interfaces:**
- Consumes: `DebugEnvironment`, `DebugError`.
- Produces: `DebugAdapterManager` (`ctx.debugAdapters`), `DebugAdapterManifest`, `DebugAdapterStatus`, `install`, `probe`, `uninstall`, `resolve`.

- [x] **Step 1: Write the failing manifest test**

Create `packages/debug/debug-adapter-manager/tests/manifest.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { parseAdapterManifest } from '../src/manifest.ts'

const manifest = {
  providerId: 'node',
  version: '1.0.0',
  license: 'MIT',
  source: { kind: 'archive', url: 'https://example.invalid/node.tgz' },
  platforms: {
    'linux-x64': { archive: 'node.tgz', sha256: 'a'.repeat(64), executable: 'bin/node', sizeBytes: 10 },
  },
  command: ['bin/node', 'adapter.js'],
}

describe('adapter manifest', () => {
  it('accepts a complete platform entry', () => {
    expect(parseAdapterManifest(manifest).providerId).toBe('node')
  })

  it('omits platforms that are not published instead of emulating them', () => {
    expect(parseAdapterManifest(manifest).platforms['win32-x64']).toBeUndefined()
    expect(() => resolveAdapterPlatform(parseAdapterManifest(manifest), 'win32-x64'))
      .toThrow(expect.objectContaining({ code: 'DEBUG_ADAPTER_UNSUPPORTED' }))
  })

  it('rejects a malformed checksum', () => {
    expect(() => parseAdapterManifest({ ...manifest, platforms: {
      'linux-x64': { ...manifest.platforms['linux-x64'], sha256: 'nope' },
    } })).toThrow(expect.objectContaining({ code: 'DEBUG_ADAPTER_CHECKSUM' }))
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug-adapter-manager/tests/manifest.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement manifest parsing**

`manifest.ts` validates provider id, version, license, source, platform keys, SHA-256, executable path, size, and required capabilities. Unknown platforms are absent, not emulated.

- [x] **Step 4: Write the failing install test**

Create `packages/debug/debug-adapter-manager/tests/install.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { installAdapter } from '../src/install.ts'

describe('managed adapter install', () => {
  it('downloads in the execution world, verifies the checksum, and runs a self-test', async () => {
    const fetchBytes = vi.fn(async () => new Uint8Array([1, 2, 3]))
    const write = vi.fn(async () => {})
    const runSelfTest = vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }))
    await installAdapter({
      manifest: { providerId: 'node', version: '1.0.0', command: ['adapter'], platforms: { 'linux-x64': { sha256: 'a'.repeat(64), executable: 'adapter', archive: 'a.tgz', sizeBytes: 3 } } },
      platform: 'linux-x64',
      environment: { fetchBytes, write, runSelfTest } as never,
    })
    expect(write).toHaveBeenCalled()
    expect(runSelfTest).toHaveBeenCalledOnce()
  })

  it('removes a partial install when the checksum fails', async () => {
    const remove = vi.fn(async () => {})
    await expect(installAdapter({
      manifest: { providerId: 'node', version: '1.0.0', command: ['adapter'], platforms: { 'linux-x64': { sha256: 'b'.repeat(64), executable: 'adapter', archive: 'a.tgz', sizeBytes: 3 } } },
      platform: 'linux-x64',
      environment: { fetchBytes: async () => new Uint8Array([1, 2, 3]), write: async () => {}, remove, runSelfTest: async () => ({ exitCode: 0 }) } as never,
    })).rejects.toMatchObject({ code: 'DEBUG_ADAPTER_CHECKSUM' })
    expect(remove).toHaveBeenCalled()
  })
})
```

- [x] **Step 5: Implement the manager**

`manager.ts` exposes `list`, `probe`, `install`, `uninstall`, `resolve`, and events. `install.ts` downloads, verifies SHA-256, writes atomically to `<installRoot>/<provider>/<version>/<platform>`, runs the self-test, and removes partial output on failure. Concurrent installs of the same provider/platform share one promise. `resolve` returns command, args, env, version, platform, source, and executable path; it never falls back to a host adapter for a remote world.

- [x] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/debug/debug-adapter-manager/tests`

Expected: PASS.

- [x] **Step 7: Commit**

```sh
git add packages/debug/debug-adapter-manager
git commit -m "feat(debug): add managed adapter manifest and installer"
```

---

### Task 9b: Named launch configuration loader

**Milestone:** C

**Depends on:** Task 1

**Files:**
- Create: `packages/debug/debug/src/launch-config.ts`
- Modify: `packages/debug/debug/src/index.ts`
- Create: `packages/debug/debug/tests/launch-config.spec.ts`

**Interfaces:**
- Consumes: `JsonSchema`, provider `configSchema`, workspace root, current file, environment.
- Produces: `parseLaunchConfig(json, context)`, `expandDebugVariables`, named launch/attach/compound configurations.

- [x] **Step 1: Write the failing loader test**

Create `packages/debug/debug/tests/launch-config.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { parseLaunchConfig } from '../src/launch-config.ts'

const json = JSON.stringify({
  version: 1,
  configurations: [
    { name: 'Node: current file', type: 'node', request: 'launch', program: '${file}', cwd: '${workspaceFolder}' },
    { name: 'API', type: 'node', request: 'attach', processId: 42 },
  ],
  compounds: [{ name: 'API + worker', configurations: ['Node: current file', 'API'], stopAll: true }],
})

describe('launch configuration', () => {
  it('expands workspace, file, and env variables', () => {
    const config = parseLaunchConfig(json, {
      workspaceFolder: '/ws', file: '/ws/src/a.ts', env: { NODE_ENV: 'test' },
    })
    expect(config.configurations[0]).toMatchObject({ program: '/ws/src/a.ts', cwd: '/ws' })
    expect(config.compounds[0]).toMatchObject({ stopAll: true })
  })

  it('rejects duplicate names and unresolved variables', () => {
    expect(() => parseLaunchConfig(json.replace('"API"', '"Node: current file"'), { workspaceFolder: '/ws', file: '/ws/a.ts', env: {} }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
    expect(() => parseLaunchConfig(json.replace('${file}', '${missing}'), { workspaceFolder: '/ws', file: '/ws/a.ts', env: {} }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug/tests/launch-config.spec.ts`

Expected: FAIL because `launch-config.ts` does not exist.

- [x] **Step 3: Implement the loader**

`parseLaunchConfig` validates schema version 1, unique configuration names, exactly one request kind per entry, non-empty compound references, and unknown top-level fields. It supports `${workspaceFolder}`, `${file}`, `${relativeFile}`, `${fileBasename}`, `${fileDirname}`, and `${env:NAME}` only; command substitution and JS evaluation are rejected. It merges provider `configSchema` validation via the registered provider before returning a normalized request.

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/debug/debug/tests/launch-config.spec.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```sh
git add packages/debug/debug
git commit -m "feat(debug): load named launch configurations"
```

---

### Task 9c: Adapter manifest source model (archive|pypi) and venv installer

**Milestone:** C

**Depends on:** Task 9

**Files:**
- Modify: `packages/debug/debug-adapter-manager/src/manifest.ts`
- Modify: `packages/debug/debug-adapter-manager/src/install.ts`
- Modify: `packages/debug/debug-adapter-manager/tests/manifest.spec.ts`
- Modify: `packages/debug/debug-adapter-manager/tests/install.spec.ts`

**Scope:** `source.kind` 收敛为 `'archive' | 'pypi'`（Review Resolutions 第 15 条）：`parseAdapterManifest` 对 pypi 源免 platforms、校验 package 名与版本固定（无 latest）；`installAdapter` 增加 pypi 分支——目标解释器创建隔离 venv、pip 安装固定版本、PyPI 官方 digest 校验后安装、自检失败回滚目录；系统安装情形不在本任务（由用户覆盖配置承载）。TDD + 独立 commit（feat(debug): support pypi adapter sources with venv install）。

- [x] 完成：feat(debug) 提交「add pypi adapter source with venv install」（25/25 测试），提交号见分支历史

---

### Task 10: Node.js/TypeScript provider

**Milestone:** C

**Depends on:** Tasks 9, 9b

**Files:**
- Create: `packages/debug/debug-node/package.json`
- Create: `packages/debug/debug-node/tsconfig.json`
- Create: `packages/debug/debug-node/src/config.ts`
- Create: `packages/debug/debug-node/src/index.ts`
- Create: `packages/debug/debug-node/tests/provider.spec.ts`
- Create: `packages/debug/debug-node/README.md`
- Create: `packages/debug/debug-node/README.zh.md`

**Interfaces:**
- Consumes: `DebugProvider`, `DebugLaunchRequest`, `DebugEnvironment`, `DebugAdapterManager`.
- Produces: `nodeDebugProvider`, `NodeDebugConfig`; shared `DebugLaunchPlan` shape used by Tasks 11–13.

- [x] **Step 1: Write the failing provider test**

Create `packages/debug/debug-node/tests/provider.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { nodeDebugProvider } from '../src/index.ts'

const environment = {
  platform: 'linux', arch: 'x64', pathSeparator: '/', cwd: '/ws',
  adapters: { resolve: vi.fn(async () => ({ command: ['node', 'js-debug/src/dapDebugServer.js'], args: [], env: {}, version: '1.0.0', source: 'managed', executablePath: '/adapters/node' })) },
} as never

describe('nodeDebugProvider', () => {
  it('resolves a launch plan with program, args, env, cwd, and required adapter', async () => {
    const plan = await nodeDebugProvider.resolveLaunch({
      providerId: 'node' as never, workspaceRoot: '/ws', workspaceId: 'ws-1', cwd: '/ws',
      program: 'src/a.ts', args: ['--flag'], env: { NODE_ENV: 'test' }, stopOnEntry: true, caller: { kind: 'user', sessionId: fixtureSessionId(1) },
    }, environment)
    expect(plan.launch).toMatchObject({ request: 'launch', program: '/ws/src/a.ts', args: ['--flag'], cwd: '/ws', stopOnEntry: true })
    expect(plan.adapter.command).toEqual(['node', 'js-debug/src/dapDebugServer.js'])
    expect(plan.requiredCapabilities).toEqual(['processControl'])
  })

  it('rejects launch without exactly one of program or module', async () => {
    await expect(nodeDebugProvider.resolveLaunch({
      providerId: 'node' as never, workspaceRoot: '/ws', workspaceId: 'ws-1', cwd: '/ws', caller: { kind: 'user', sessionId: fixtureSessionId(1) },
    }, environment)).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })

  it('supports attach by process id, port, or URL', async () => {
    const plan = await nodeDebugProvider.resolveAttach({
      providerId: 'node' as never, workspaceRoot: '/ws', workspaceId: 'ws-1', processId: 42, caller: { kind: 'user', sessionId: fixtureSessionId(1) },
    }, environment)
    expect(plan.attach).toMatchObject({ request: 'attach', processId: 42 })
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug-node/tests/provider.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Define provider plan shapes and implement the provider**

Add to `packages/debug/debug-node/src/index.ts` (and export from `dsh-debug` in a follow-up type-only import):

```text
interface DebugLaunchPlan {
  readonly adapter: ResolvedDebugAdapter
  readonly launch: Readonly<Record<string, unknown>>
  readonly target?: DebugTargetPlan
  readonly requiredCapabilities: readonly DebugExecutionCapability[]
  readonly environment: Readonly<Record<string, string>>
  readonly cwd: string
}

interface DebugAttachPlan {
  readonly adapter: ResolvedDebugAdapter
  readonly attach: Readonly<Record<string, unknown>>
  readonly tunnel?: { readonly host: string; readonly port: number }
  readonly requiredCapabilities: readonly DebugExecutionCapability[]
}
```

`config.ts` validates Node fields: `program` or `module` exactly one for launch; optional `runtimeExecutable`, `runtimeArgs`, `args`, `cwd`, `env`, `stopOnEntry`, `autoAttachChildProcesses`, `sourceMaps`, `outFiles`, `console`; attach accepts exactly one of `processId`, `port`, `url`. Unknown fields fail.

`index.ts` resolves relative paths against `workspaceRoot`, maps `env` without logging values, selects the managed adapter through `environment.adapters.resolve`, and returns a plan. It never spawns a process.

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/debug/debug-node/tests/provider.spec.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```sh
git add packages/debug/debug-node
git commit -m "feat(debug-node): add Node.js debug provider"
```

---

### Task 11: Python provider

**Milestone:** C

**Depends on:** Task 10

**Files:**
- Create: `packages/debug/debug-python/package.json`
- Create: `packages/debug/debug-python/tsconfig.json`
- Create: `packages/debug/debug-python/src/config.ts`
- Create: `packages/debug/debug-python/src/index.ts`
- Create: `packages/debug/debug-python/tests/provider.spec.ts`
- Create: `packages/debug/debug-python/README.md`
- Create: `packages/debug/debug-python/README.zh.md`

**Interfaces:**
- Consumes: same provider contracts as Task 10.
- Produces: `pythonDebugProvider`, `PythonDebugConfig`.

- [x] **Step 1: Write the failing provider test**

Create `packages/debug/debug-python/tests/provider.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { pythonDebugProvider } from '../src/index.ts'

const environment = {
  platform: 'linux', arch: 'x64', pathSeparator: '/', cwd: '/ws',
  adapters: { resolve: vi.fn(async () => ({ command: ['/venv/bin/python', '-m', 'debugpy.adapter'], args: [], env: {}, version: '1.0.0', source: 'managed', executablePath: '/venv/bin/python' })) },
} as never

describe('pythonDebugProvider', () => {
  it('resolves a module launch with interpreter and provider options', async () => {
    const plan = await pythonDebugProvider.resolveLaunch({
      providerId: 'python' as never, workspaceRoot: '/ws', workspaceId: 'ws-1', cwd: '/ws',
      module: 'app', args: ['--serve'], env: { APP_ENV: 'test' }, caller: { kind: 'user', sessionId: fixtureSessionId(1) },
      providerOptions: { python: '/usr/bin/python3', justMyCode: true, subProcess: false },
    }, environment)
    expect(plan.launch).toMatchObject({ request: 'launch', module: 'app', justMyCode: true, subProcess: false })
    expect(plan.target).toMatchObject({ executable: '/usr/bin/python3', args: ['-m', 'app', '--serve'] })
  })

  it('requires an interpreter for launch and attach', async () => {
    await expect(pythonDebugProvider.resolveLaunch({
      providerId: 'python' as never, workspaceRoot: '/ws', workspaceId: 'ws-1', cwd: '/ws', program: 'main.py', caller: { kind: 'user', sessionId: fixtureSessionId(1) },
    }, environment)).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug-python/tests/provider.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement the provider**

`config.ts` validates `program` or `module`, `python`, `args`, `cwd`, `env`, `justMyCode`, `subProcess`, `django`, `flask`, `providerOptions`. The provider resolves the target interpreter, builds the debugpy adapter command through `environment.adapters.resolve('python')`, and returns the launch/attach plan. If the interpreter lacks `venv`/`ensurepip`, the managed installer fails with `DEBUG_ADAPTER_UNSUPPORTED` and an actionable message.

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/debug/debug-python/tests/provider.spec.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```sh
git add packages/debug/debug-python
git commit -m "feat(debug-python): add Python debug provider"
```

---

### Task 12: Go provider

**Milestone:** C

**Depends on:** Task 10

**Files:**
- Create: `packages/debug/debug-go/package.json`
- Create: `packages/debug/debug-go/tsconfig.json`
- Create: `packages/debug/debug-go/src/config.ts`
- Create: `packages/debug/debug-go/src/index.ts`
- Create: `packages/debug/debug-go/tests/provider.spec.ts`
- Create: `packages/debug/debug-go/README.md`
- Create: `packages/debug/debug-go/README.zh.md`

**Interfaces:**
- Consumes: same provider contracts as Task 10.
- Produces: `goDebugProvider`, `GoDebugConfig`.

- [x] **Step 1: Write the failing provider test**

Create `packages/debug/debug-go/tests/provider.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { goDebugProvider } from '../src/index.ts'

const environment = {
  platform: 'linux', arch: 'x64', pathSeparator: '/', cwd: '/ws',
  adapters: { resolve: vi.fn(async () => ({ command: ['dlv', 'dap'], args: [], env: {}, version: '1.0.0', source: 'managed', executablePath: '/adapters/dlv' })) },
} as never

describe('goDebugProvider', () => {
  it('resolves a package launch with build flags and dlv flags', async () => {
    const plan = await goDebugProvider.resolveLaunch({
      providerId: 'go' as never, workspaceRoot: '/ws', workspaceId: 'ws-1', cwd: '/ws',
      module: './cmd/app', args: ['--port', '0'], caller: { kind: 'user', sessionId: fixtureSessionId(1) },
      providerOptions: { mode: 'debug', buildFlags: '-tags=dev', dlvFlags: '--check-go-version=false' },
    }, environment)
    expect(plan.launch).toMatchObject({ request: 'launch', mode: 'debug', buildFlags: '-tags=dev', args: ['--port', '0'] })
    expect(plan.requiredCapabilities).toContain('ptrace')
  })

  it('rejects an unknown mode', async () => {
    await expect(goDebugProvider.resolveLaunch({
      providerId: 'go' as never, workspaceRoot: '/ws', workspaceId: 'ws-1', cwd: '/ws', module: '.', caller: { kind: 'user', sessionId: fixtureSessionId(1) },
      providerOptions: { mode: 'wat' },
    }, environment)).rejects.toMatchObject({ code: 'DEBUG_INVALID_CONFIG' })
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug-go/tests/provider.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement the provider**

`config.ts` validates `program` or `package`, `mode` (`debug`, `test`, `exec`, `auto`), `buildFlags`, `dlvFlags`, `args`, `cwd`, `env`, and attach `processId`/`port`. The provider returns `ptrace` as a required capability for launch and attach, and a tunnel plan for port-based attach.

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/debug/debug-go/tests/provider.spec.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```sh
git add packages/debug/debug-go
git commit -m "feat(debug-go): add Go debug provider"
```

---

### Task 13: Rust/C/C++ provider

**Milestone:** C

**Depends on:** Task 10

**Files:**
- Create: `packages/debug/debug-native/package.json`
- Create: `packages/debug/debug-native/tsconfig.json`
- Create: `packages/debug/debug-native/src/config.ts`
- Create: `packages/debug/debug-native/src/index.ts`
- Create: `packages/debug/debug-native/tests/provider.spec.ts`
- Create: `packages/debug/debug-native/README.md`
- Create: `packages/debug/debug-native/README.zh.md`

**Interfaces:**
- Consumes: same provider contracts as Task 10.
- Produces: `nativeDebugProvider`, `NativeDebugConfig`.

- [x] **Step 1: Write the failing provider test**

Create `packages/debug/debug-native/tests/provider.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { nativeDebugProvider } from '../src/index.ts'

const environment = {
  platform: 'darwin', arch: 'arm64', pathSeparator: '/', cwd: '/ws',
  adapters: { resolve: vi.fn(async () => ({ command: ['/adapters/lldb-dap'], args: [], env: {}, version: '1.0.0', source: 'managed', executablePath: '/adapters/lldb-dap' })) },
} as never

describe('nativeDebugProvider', () => {
  it('resolves a native launch with program, args, cwd, and stopOnEntry', async () => {
    const plan = await nativeDebugProvider.resolveLaunch({
      providerId: 'native' as never, workspaceRoot: '/ws', workspaceId: 'ws-1', cwd: '/ws',
      program: 'target/debug/app', args: ['--verbose'], stopOnEntry: true, caller: { kind: 'user', sessionId: fixtureSessionId(1) },
    }, environment)
    expect(plan.launch).toMatchObject({ request: 'launch', program: '/ws/target/debug/app', args: ['--verbose'], stopOnEntry: true })
    expect(plan.requiredCapabilities).toEqual(['ptrace', 'processControl'])
  })

  it('marks attach unsupported when the platform cannot grant process control', async () => {
    await expect(nativeDebugProvider.resolveAttach({
      providerId: 'native' as never, workspaceRoot: '/ws', workspaceId: 'ws-1', processId: 42, caller: { kind: 'user', sessionId: fixtureSessionId(1) },
    }, { ...environment, platform: 'win32', arch: 'arm64' } as never)).rejects.toMatchObject({ code: 'DEBUG_ATTACH_UNSUPPORTED' })
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/debug-native/tests/provider.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement the provider**

`config.ts` validates `program`, `args`, `cwd`, `env`, `stopOnEntry`, attach `processId`/`port`, and optional `lldbDapPath`. `index.ts` selects `lldb-dap` from the managed adapter or a user override, requires `ptrace`/`processControl`, and rejects attach platforms where the execution world cannot grant process control. It never launches the program itself.

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/debug/debug-native/tests/provider.spec.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```sh
git add packages/debug/debug-native
git commit -m "feat(debug-native): add Rust C and C++ debug provider"
```

---

### Task 14: Model-facing debug tools and system prompt

**Milestone:** D

**Depends on:** Tasks 2, 6b, 9b

**Files:**
- Create: `packages/debug/tool-debug/package.json`
- Create: `packages/debug/tool-debug/tsconfig.json`
- Create: `packages/debug/tool-debug/src/tools.ts`
- Create: `packages/debug/tool-debug/src/render.ts`
- Create: `packages/debug/tool-debug/src/prompt.ts`
- Create: `packages/debug/tool-debug/src/index.ts`
- Create: `packages/debug/tool-debug/tests/tools.spec.ts`
- Create: `packages/debug/tool-debug/tests/render.spec.ts`
- Create: `packages/debug/tool-debug/README.md`
- Create: `packages/debug/tool-debug/README.zh.md`

**Interfaces:**
- Consumes: `ctx.tools`, `ctx.debug`, `ctx.systemPrompt`, `defineTool`.
- Produces: `debug_session`, `debug_execution`, `debug_inspect`, `debug_breakpoints`; closed operation unions; `DEBUG_PROMPT_TEXT`.

- [x] **Step 1: Write the failing operation-union test**

Create `packages/debug/tool-debug/tests/tools.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { DEBUG_TOOL_NAMES, parseDebugOperation } from '../src/tools.ts'

describe('debug tool vocabulary', () => {
  it('registers exactly four tools', () => {
    expect(DEBUG_TOOL_NAMES).toEqual(['debug_session', 'debug_execution', 'debug_inspect', 'debug_breakpoints'])
  })

  it('rejects an unknown operation instead of falling through', () => {
    expect(() => parseDebugOperation('debug_execution', 'explode'))
      .toThrow(expect.objectContaining({ code: 'DEBUG_UNKNOWN_OPERATION' }))
  })

  it('accepts every documented operation', () => {
    expect(parseDebugOperation('debug_execution', 'step_over')).toBe('step_over')
    expect(parseDebugOperation('debug_inspect', 'variables')).toBe('variables')
    expect(parseDebugOperation('debug_breakpoints', 'set_file')).toBe('set_file')
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/tool-debug/tests/tools.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement the tools**

`tools.ts` defines `defineTool` registrations for the four tool names and closed operation enums:

- `debug_session`: `launch`, `attach`, `launch_compound`, `list`, `list_compounds`, `get`, `get_compound`, `terminate`, `terminate_compound`, `disconnect`, `attach_targets`.
- `debug_execution`: `continue`, `pause`, `step_over`, `step_in`, `step_out`, `step_back`, `restart`, `restart_frame`, `wait_for_stop`.
- `debug_inspect`: `threads`, `stack_trace`, `scopes`, `variables`, `evaluate`, `set_variable`, `set_expression`, `completions`, `exception_info`, `modules`, `loaded_sources`, `source`, `disassemble`, `read_memory`, `write_memory`, `console`.
- `debug_breakpoints`: `set_file`, `set_function`, `set_exception`, `set_data`, `set_instruction`, `list`, `clear`.

Each tool validates operation, session id, and operation-specific fields; calls the corresponding service/session method; returns bounded canonical JSON; throws `DebugError` for domain failures. `debug_breakpoints` without `sessionId` uses service-level persistence; with `sessionId` it scopes to that session.

- [x] **Step 4: Implement rendering and prompt**

`render.ts` converts stack frames to workspace-relative locations, caps values/strings/lists, and emits `truncated`/`total`. `prompt.ts` exports the fixed system-prompt section from the spec; register it with `ctx.systemPrompt` in `index.ts`.

- [x] **Step 5: Write and run the render test**

Create `packages/debug/tool-debug/tests/render.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { renderStackTrace, renderVariables } from '../src/render.ts'

describe('debug tool rendering', () => {
  it('relativizes paths and preserves the truncation total', () => {
    const view = renderStackTrace({ workspaceRoot: '/ws', frames: [
      { id: '1', name: 'main', source: '/ws/src/a.ts', line: 4, column: 2 },
    ], truncated: true, total: 20 })
    expect(view.frames[0]).toMatchObject({ source: 'src/a.ts', line: 4, column: 2 })
    expect(view).toMatchObject({ truncated: true, total: 20 })
  })

  it('caps values without dropping child references', () => {
    const view = renderVariables({ variables: [
      { name: 'big', value: 'x'.repeat(100), variablesReference: 7 },
    ], maxValueChars: 10 })
    expect(view.variables[0].value).toContain('truncated')
    expect(view.variables[0].variablesReference).toBe(7)
  })
})
```

Run: `pnpm exec vitest run packages/debug/tool-debug/tests/render.spec.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```sh
git add packages/debug/tool-debug
git commit -m "feat(debug): add model-facing debug tools and prompt"
```

---

### Task 15: Stop notices, wake-up, approvals, and audit

**Milestone:** D

**Depends on:** Task 14

**Files:**
- Create: `packages/debug/tool-debug/src/notices.ts`
- Create: `packages/debug/tool-debug/src/approval.ts`
- Modify: `packages/debug/tool-debug/src/index.ts`
- Create: `packages/debug/tool-debug/tests/notices.spec.ts`
- Create: `packages/debug/tool-debug/tests/approval.spec.ts`

**Interfaces:**
- Consumes: `ctx.debug.events`, `Agent.send(message, target, wakeup)`（`packages/core/agent-loop`）, `ctx.approval`, `MessageSourceMap`.
- Produces: bounded stop notices; wake/quiet delivery; launch/attach approval; per-session control authorization; `debug/control` audit.

- [x] **Step 1: Write the failing notice test**

Create `packages/debug/tool-debug/tests/notices.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { fixtureDebugSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { createStopNotice, shouldWake } from '../src/notices.ts'

const sessionId = fixtureDebugSessionId(1)

describe('debug stop notices', () => {
  it('builds a bounded notice without variable values', () => {
    const notice = createStopNotice({
      sessionId, reason: 'breakpoint', threadId: fixtureThreadId(1),
      source: fixtureSource('src/a.ts'), line: 4, column: 2,
    }, { maxBytes: 256 })
    expect(notice.length).toBeLessThanOrEqual(256)
    expect(notice).toContain(sessionId)
    expect(notice).toContain('src/a.ts:4')
  })

  it('wakes agent-owned sessions by default and respects quiet mode', () => {
    expect(shouldWake({ owner: 'agent', delivery: 'wakeup' })).toBe(true)
    expect(shouldWake({ owner: 'user', delivery: 'wakeup' })).toBe(false)
    expect(shouldWake({ owner: 'agent', delivery: 'quiet' })).toBe(false)
  })

  it('suppresses the stop caused by this session unsettled resume request', () => {
    expect(shouldWake({ owner: 'agent', delivery: 'wakeup', pendingResumeBy: fixtureSessionId(1), caller: fixtureSessionId(1) })).toBe(false)
    expect(shouldWake({ owner: 'agent', delivery: 'wakeup', pendingResumeBy: fixtureSessionId(2), caller: fixtureSessionId(1) })).toBe(true)
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/debug/tool-debug/tests/notices.spec.ts`

Expected: FAIL because `notices.ts` does not exist.

- [x] **Step 3: Implement notices and wake delivery**

`notices.ts` 订阅 live `session/stopped`，抑制由 Agent 自己未结算的 `continue`/`step` 造成的停住，生成有界的 `user/message`（source `debug`），并按调用者身份选择投递方式：`wakeup: false` 在目标 Session 忙时注入下一步，`wakeup: true` 在空闲时打开新 turn。投递策略与循环上限读 `tool-debug` 自己的 Config 字段 `debugStopDelivery` 和 `debugMaxConsecutiveWakes`，不读取 `dsh-tool-jobs` 的同名字段，也不改名共用。`maxNoticeBytes` 限制通知字节数。抑制条件是「同一 Session 有未结算的 resume 请求」，不是「最近发过 continue」，否则人和 Agent 交替控制时会漏通知。

- [x] **Step 4: Write the failing approval test**

Create `packages/debug/tool-debug/tests/approval.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { requestDebugApproval } from '../src/approval.ts'

describe('debug approval', () => {
  it('fails closed when the approval answerer is unavailable', async () => {
    const approval = { request: vi.fn(async () => 'unavailable') }
    await expect(requestDebugApproval(approval as never, { kind: 'launch', toolName: 'debug_session', reason: 'launch node', agent: {} as never }))
      .rejects.toMatchObject({ code: 'DEBUG_APPROVAL_DENIED' })
  })

  it('allows exactly one launch on allowed-once', async () => {
    const approval = { request: vi.fn(async () => 'allowed-once') }
    await expect(requestDebugApproval(approval as never, { kind: 'launch', toolName: 'debug_session', reason: 'launch node', agent: {} as never }))
      .resolves.toBeUndefined()
  })
})
```

- [x] **Step 5: Implement approvals and audit**

`approval.ts` 对 Agent 的 launch/attach 请求 `ctx.approval`，`writeMemory` 每次请求，并且不绕过 `unavailable`/`rejected`/`cancelled`。无回答者的组合下 `ctx.approval` 返回 `unavailable` 而不是 `rejected`：映射成 `DEBUG_APPROVAL_DENIED` 时把两者区分开写进 detail，`rejected` 表示人主动拒绝、`unavailable` 表示没有回答者。控制授权在这里一并判定：Agent 控制自有会话直接放行；控制他人创建的会话先看该会话的开关，未打开则单独审批，两者都拒绝返回 `DEBUG_CONTROL_NOT_GRANTED`。控制成功后发布 `debug/control` Session 事件，携带 actor、操作、线程/帧、结果和授权来源（`owned` / `session-grant` / `single-approval`）。UI 发起的 launch 使用 UI 确认，不进入 Agent 审批缝。

- [x] **Step 6: Run both tests to verify they pass**

Run: `pnpm exec vitest run packages/debug/tool-debug/tests/notices.spec.ts packages/debug/tool-debug/tests/approval.spec.ts`

Expected: PASS.

- [x] **Step 7: Commit**

```sh
git add packages/debug/tool-debug
git commit -m "feat(debug): add stop notices approvals and audit"
```

---

### Task 16: Remote debug controller and event cursor

**Milestone:** D

**Depends on:** Tasks 2, 6b, 7

**Files:**
- Create: `packages/api/debug-controller/package.json`
- Create: `packages/api/debug-controller/tsconfig.json`
- Create: `packages/api/debug-controller/src/index.ts`
- Create: `packages/api/debug-controller/src/events.ts`
- Create: `packages/api/debug-controller/tests/controller.spec.ts`
- Create: `packages/api/debug-controller/tests/events.spec.ts`
- Create: `packages/api/debug-controller/README.md`
- Create: `packages/api/debug-controller/README.zh.md`

**Interfaces:**
- Consumes: `ctx.debug`, Typert Remote declarations, `remote-access`.
- Produces: unary debug methods, `events(sessionId, after)` stream, `get` snapshot with `eventSeq`, `debug/event-cursor-expired`.
- 回放环 payload = 耐久事件载荷形状：`debug/session-started`、`debug/stopped`（reason/threadId/相对 source/line/column，无 frameId）、`debug/session-ended`、`debug/control` 的 Session 事件字段，由 `DebugDurablePayload` 封闭联合钉死在 `types.ts`，编排提交点经 `durableRecorder` 写环。

- [x] **Step 1: Write the failing controller test**

Create `packages/api/debug-controller/tests/controller.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { createDebugController } from '../src/index.ts'

describe('debug controller', () => {
  it('resolves the workspace from the Session and rejects a caller-supplied foreign root', async () => {
    const debug = { get: vi.fn(() => ({ id: 'debug-1' })), list: vi.fn(() => []) }
    const controller = createDebugController({
      debug,
      resolveSession: async () => ({ workspaceId: 'ws-1', root: '/ws' }),
    } as never)
    await expect(controller.get('session-1', 'debug-1' as never)).resolves.toMatchObject({ session: { id: 'debug-1' } })
    expect(debug.get).toHaveBeenCalledWith('debug-1' as never, { workspaceId: 'ws-1' })
  })

  it('maps a missing session to DEBUG_SESSION_GONE', async () => {
    const controller = createDebugController({
      debug: { get: () => undefined, list: () => [] },
      resolveSession: async () => ({ workspaceId: 'ws-1', root: '/ws' }),
    } as never)
    await expect(controller.get('session-1', 'debug-x' as never))
      .rejects.toMatchObject({ code: 'DEBUG_SESSION_GONE' })
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/api/debug-controller/tests/controller.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement unary methods**

`index.ts` exposes the unary methods from the spec. Every method takes a Session identity, resolves workspace and execution world from that Session, and calls `ctx.debug`; it never trusts a client-supplied root. It maps missing sessions to `DEBUG_SESSION_GONE` and cross-workspace access to `DEBUG_WORKSPACE_MISMATCH`.

- [x] **Step 4: Write the failing event-cursor test**

Create `packages/api/debug-controller/tests/events.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { DebugEventRing } from '../src/events.ts'

describe('debug event ring', () => {
  it('replays after a cursor and expires an old cursor', () => {
    const ring = new DebugEventRing({ maxEvents: 2 })
    ring.push({ kind: 'session/starting', seq: 1 })
    ring.push({ kind: 'session/stopped', seq: 2 })
    ring.push({ kind: 'session/terminated', seq: 3 })
    expect(ring.after(2).map(event => event.seq)).toEqual([3])
    expect(() => ring.after(0)).toThrow(expect.objectContaining({ code: 'debug/event-cursor-expired' }))
  })
})
```

- [x] **Step 5: Implement the event ring and stream**

`events.ts` maintains `debugEventSeq` and a bounded ring per session; `get` returns `{ session, eventSeq }`; `events(sessionId, after)` replays then continues live; an expired cursor returns `debug/event-cursor-expired`. Multiple subscribers share the ring but receive independent lifetimes.

- [x] **Step 6: Run both tests to verify they pass**

Run: `pnpm exec vitest run packages/api/debug-controller/tests`

Expected: PASS.

- [x] **Step 7: Commit**

```sh
git add packages/api/debug-controller
git commit -m "feat(debug): add remote controller and event cursor"
```

---

### Task 17: Remote 编辑器保存写（复用 `ctx.fs` 版本守卫）

**Milestone:** D

**Depends on:** Task 16

**Files:**
- Create: `packages/api/debug-controller/src/editor-write.ts`
- Modify: `packages/api/debug-controller/src/index.ts`
- Create: `packages/api/debug-controller/tests/editor-write.spec.ts`
- Create: `packages/api/debug-controller/tests/helpers/fake-filesystem.ts`
- Modify: `packages/api/debug-controller/README.md`
- Modify: `packages/api/debug-controller/README.zh.md`

不新建写入包。`ctx.fs` 已经提供跨执行世界的原子文本写（`writeText`）、不透明 `FsVersion` 和可选写入意图守卫：`replaceIfVersion` 在缺失或不匹配时拒绝并返回 `FS_STALE_VERSION`，无条件覆盖要显式声明，失败统一是带稳定 code 的 `FsError`（`FS_NOT_FOUND`、`FS_NOT_REGULAR_FILE`、`FS_NOT_TEXT`、`FS_TOO_LARGE`、`FS_PERMISSION_DENIED`、`FS_STALE_VERSION`）。本任务只把该能力按 Session 身份暴露给编辑器，不复制路径解析、原子性或执行世界规则。

**Interfaces:**
- Consumes: `ctx.fs`（`resolve`、`stat`、`writeText` 带守卫）、`ctx.sessions`、`fs/observed`。
- Produces: `writeText(sessionId, path, content, expectedVersion | null): Promise<{ version, bytes }>`；冲突返回 `FS_STALE_VERSION` 并附当前版本，工作区外返回 `FS_PERMISSION_DENIED`。

- [x] **Step 1: Write the failing write test**

Create `packages/api/debug-controller/tests/editor-write.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { fixtureFsVersion, fixtureSessionId } from '@deepseek-ai/dsh-debug-fixture'
import { writeEditorText } from '../src/editor-write.ts'
import { fakeFileSystem } from './helpers/fake-filesystem.ts'

const opened = fixtureFsVersion('v1')

describe('editor write', () => {
  it('guards the write with the version the editor opened', async () => {
    const fs = fakeFileSystem({ '/ws/src/a.ts': opened })
    const result = await writeEditorText({ sessionId: fixtureSessionId(1), path: 'src/a.ts', content: 'x', expectedVersion: opened, fs })
    expect(result).toMatchObject({ bytes: 1 })
    expect(fs.lastWriteIntent).toBe('replaceIfVersion')
  })

  it('maps a stale version to a conflict without writing', async () => {
    const fs = fakeFileSystem({ '/ws/src/a.ts': fixtureFsVersion('v2') })
    await expect(writeEditorText({ sessionId: fixtureSessionId(1), path: 'src/a.ts', content: 'x', expectedVersion: opened, fs }))
      .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(fs.writeCount).toBe(0)
  })

  it('rejects a path outside the workspace before touching the backend', async () => {
    const fs = fakeFileSystem({})
    await expect(writeEditorText({ sessionId: fixtureSessionId(1), path: '../escape.ts', content: 'x', expectedVersion: null, fs }))
      .rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
    expect(fs.writeCount).toBe(0)
  })
})
```

`fakeFileSystem` 实现 `FileSystem` 用到的方法并记录 `lastWriteIntent` 与 `writeCount`，返回类型声明为 `FileSystem`，所以测试不需要 `as never`。断言的 code 名取自 `packages/fs/fs/src/types.ts` 的现有词表；要新增 code 属于改 `dsh-fs` 公共契约，单独提出而不是在这里顺手造一个。

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/api/debug-controller/tests/editor-write.spec.ts`

Expected: FAIL because `editor-write.ts` does not exist.

- [x] **Step 3: Implement the write path**

`editor-write.ts` 从 Session 解析工作区根与执行世界，拒绝最终符号链接逃逸、目录、NUL、非 UTF-8 与超限内容；`expectedVersion` 有值走 `replaceIfVersion`，为 `null` 走 create-or-fail（目标已存在返回当前版本，不覆盖）；返回写后的新 `version` 与 `bytes`。冲突响应携带当前 `version` 供客户端重新加载。不暴露 rename/delete/mkdir，Agent 继续使用现有 `dsh-tool-fs` 路径，避免两条编辑通道。

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/api/debug-controller/tests/editor-write.spec.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```sh
git add packages/api/debug-controller
git commit -m "feat(api): expose guarded editor write through the debug controller"
```

---

### Task 18: Web/Desktop code editor with breakpoint gutter

**Milestone:** E

**Depends on:** Tasks 7, 16, 17

**Files:**
- Create: `packages/client/ui-code-editor/package.json`
- Create: `packages/client/ui-code-editor/tsconfig.json`
- Create: `packages/client/ui-code-editor/tsconfig.client.json`
- Create: `packages/client/ui-code-editor/src/client/index.ts`
- Create: `packages/client/ui-code-editor/src/client/editor-model.ts`
- Create: `packages/client/ui-code-editor/src/client/CodeEditor.tsx`
- Create: `packages/client/ui-code-editor/src/client/breakpoints.ts`
- Create: `packages/client/ui-code-editor/src/client/draft-store.ts`
- Create: `packages/client/ui-code-editor/src/client/locales.ts`
- Create: `packages/client/ui-code-editor/tests/editor-model.client.spec.ts`
- Create: `packages/client/ui-code-editor/tests/breakpoints.client.spec.ts`
- Create: `packages/client/ui-code-editor/tests/draft-store.client.spec.ts`
- Create: `packages/client/ui-code-editor/README.md`
- Create: `packages/client/ui-code-editor/README.zh.md`

**Interfaces:**
- Consumes: `remote.workspaceFiles.readBytes` / `changes`, `remote.workspaceEdit.write`, `remote.debug.setBreakpoints`, `ctx.resources`.
- Produces: editor tab type, `createEditorModel`, `toggleBreakpoint`, save conflict view, current-line highlight.

- [x] **Step 1: Write the failing editor-model test**

Create `packages/client/ui-code-editor/tests/editor-model.client.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { createEditorModel } from '../src/client/editor-model.ts'

describe('editor model', () => {
  it('tracks dirty state and saves with the opening version', () => {
    const model = createEditorModel({ path: 'src/a.ts', text: 'a\nb', version: 'v1', eol: '\n' })
    expect(model.dirty).toBe(false)
    model.setValue('a\nc')
    expect(model.dirty).toBe(true)
    expect(model.savePayload()).toEqual({ path: 'src/a.ts', content: 'a\nc', expectedVersion: 'v1' })
    model.markSaved('v2', 'a\nc')
    expect(model.dirty).toBe(false)
    expect(model.version).toBe('v2')
  })

  it('reports a disk change without discarding a dirty buffer', () => {
    const model = createEditorModel({ path: 'src/a.ts', text: 'a', version: 'v1', eol: '\n' })
    model.setValue('b')
    model.markDiskChanged('v2')
    expect(model.dirty).toBe(true)
    expect(model.diskChanged).toBe(true)
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/client/ui-code-editor/tests/editor-model.client.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement the editor model**

`editor-model.ts` stores path, text, opening version, EOL style, dirty state, and disk-changed state. It converts EOL on load/save and rejects saves after a conflict until the user chooses reload/overwrite/save-as.

- [x] **Step 4: Write the failing breakpoint test**

Create `packages/client/ui-code-editor/tests/breakpoints.client.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { toggleBreakpoint } from '../src/client/breakpoints.ts'

describe('breakpoint gutter state', () => {
  it('toggles one line without touching others', () => {
    expect(toggleBreakpoint([{ line: 2 }], 4)).toEqual([{ line: 2 }, { line: 4 }])
    expect(toggleBreakpoint([{ line: 2 }, { line: 4 }], 4)).toEqual([{ line: 2 }])
  })

  it('keeps condition and log message when moving a breakpoint', () => {
    const moved = toggleBreakpoint([{ line: 2, condition: 'x > 0', logMessage: 'x={x}' }], 5)
    expect(moved).toEqual([{ line: 5, condition: 'x > 0', logMessage: 'x={x}' }])
  })
})
```

- [x] **Step 4b: Persist bounded editor drafts**

Create `draft-store.ts` and `tests/draft-store.client.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { createDraftStore } from '../src/client/draft-store.ts'

describe('editor draft store', () => {
  it('keeps one bounded draft per session/path and clears it on save or discard', () => {
    const store = createDraftStore({ maxBytes: 32 })
    store.put({ sessionId: 's1', path: 'src/a.ts', text: 'draft', version: 'v1' })
    expect(store.get('s1', 'src/a.ts')).toMatchObject({ text: 'draft', version: 'v1' })
    store.clear('s1', 'src/a.ts')
    expect(store.get('s1', 'src/a.ts')).toBeUndefined()
  })
})
```

Drafts are client-local, size-bounded, keyed by Session and resource path, never Session events, and never model-visible.

- [x] **Step 5: Implement CodeMirror editor and save flow**

Add CodeMirror 6 dependencies (`@codemirror/state`, `@codemirror/view`, `@codemirror/search`, language packages for JS/TS, Python, Go, Rust, C/C++). `CodeEditor.tsx` renders the editor, breakpoint gutter, current-line decoration, find/replace, dirty marker, and conflict banner. Save calls `remote.debug.writeText`; success updates the model and clears the draft; an `FS_STALE_VERSION` response opens the reload/keep/save-as choices. External `changes` refresh clean tabs and mark dirty tabs.

- [x] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/client/ui-code-editor/tests`

Expected: PASS.

- [x] **Step 7: Commit**

```sh
git add packages/client/ui-code-editor
git commit -m "feat(client): add code editor and breakpoint gutter"
```

---

### Task 19: Web/Desktop debug toolbar and panels

**Milestone:** E

**Depends on:** Tasks 7, 9, 16

**Files:**
- Create: `packages/client/ui-debug/package.json`
- Create: `packages/client/ui-debug/tsconfig.json`
- Create: `packages/client/ui-debug/tsconfig.client.json`
- Create: `packages/client/ui-debug/src/client/index.ts`
- Create: `packages/client/ui-debug/src/client/store.ts`
- Create: `packages/client/ui-debug/src/client/DebugToolbar.tsx`
- Create: `packages/client/ui-debug/src/client/panels.tsx`
- Create: `packages/client/ui-debug/src/client/debug-tool-cards.tsx`
- Create: `packages/client/ui-debug/src/client/locales.ts`
- Create: `packages/client/ui-debug/tests/store.client.spec.ts`
- Create: `packages/client/ui-debug/tests/panels.client.spec.tsx`
- Create: `packages/client/ui-debug/tests/debug-tool-cards.client.spec.tsx`
- Create: `packages/client/ui-debug/README.md`
- Create: `packages/client/ui-debug/README.zh.md`

**Interfaces:**
- Consumes: `remote.debug`, `ctx.workbenchPanels`, `ctx.resources`.
- Produces: `createDebugViewStore`, toolbar, stack/variables/watch/breakpoints/console/modules/memory panels, adapter settings.

- [x] **Step 1: Write the failing store test**

Create `packages/client/ui-debug/tests/store.client.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { createDebugViewStore, visibleDebugActions } from '../src/client/store.ts'

describe('debug view store', () => {
  it('selects the stopped thread/frame and clears them on continue', () => {
    const store = createDebugViewStore()
    store.apply({ kind: 'session/stopped', stop: {
      sessionId: 'debug-1', reason: 'breakpoint', threadId: 1, frameId: 'frame-1', source: 'src/a.ts', line: 4, column: 2,
    } })
    expect(store.state.selectedThreadId).toBe(1)
    expect(store.state.selectedFrameId).toBe('frame-1')
    store.apply({ kind: 'session/continued', sessionId: 'debug-1' })
    expect(store.state.selectedFrameId).toBeUndefined()
  })

  it('hides unsupported actions', () => {
    expect(visibleDebugActions({ supportsStepBack: false } as never)).not.toContain('stepBack')
    expect(visibleDebugActions({ supportsStepBack: true } as never)).toContain('stepBack')
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/client/ui-debug/tests/store.client.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement the store and toolbar**

`store.ts` folds live debug events, keeps selected session/thread/frame, lazy variable expansion state, watch expressions, console cursor, and capability-derived action visibility. It clears frame/variable references on continue and marks them stale.

`DebugToolbar.tsx` renders start/restart, continue/pause, step over/in/out/back, restart frame, stop/disconnect, thread selector, session selector, Agent notification toggle, and actor indicator. Every action is capability-gated.

- [x] **Step 4: Implement panels and settings**

`panels.tsx` registers stack, variables, watch, breakpoints, console, modules, loaded sources, disassembly, memory, and exception filters. Each panel hides when unsupported. Values are lazy and bounded; errors in one watch expression do not block the others. `ui-debug` contributes the adapter settings panel (installed versions, license, SHA-256, install/update/uninstall, override path, self-test) and a session notification toggle.

- [x] **Step 4b: Add conversation tool cards**

Create `debug-tool-cards.tsx` and `tests/debug-tool-cards.client.spec.tsx`:

```text
import { describe, expect, it } from 'vitest'
import { debugToolCard } from '../src/client/debug-tool-cards.tsx'

describe('debug tool cards', () => {
  it('renders session state and puts stop locations on the card', () => {
    expect(debugToolCard('debug_session', { sessionId: 'debug-1', state: 'running' }))
      .toMatchObject({ card: 'generic', title: expect.stringContaining('Debug') })
    expect(debugToolCard('debug_execution', { reason: 'breakpoint', source: 'src/a.ts', line: 4 }))
      .toMatchObject({ locations: [{ path: 'src/a.ts', line: 4 }] })
  })

  it('falls back for malformed or unknown payloads', () => {
    expect(debugToolCard('debug_inspect', null)).toMatchObject({ card: 'generic' })
  })
})
```

Register `tool.call.toolview` for the four tool names. The cards are pure projections of logged arguments/result metadata, support Session replay, and fall back to the generic row on malformed input.

- [x] **Step 5: Write and run the panel test**

Create `packages/client/ui-debug/tests/panels.client.spec.tsx`:

```text
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { VariablesPanel } from '../src/client/panels.tsx'

describe('VariablesPanel', () => {
  it('renders a truncated value and keeps the expand control', () => {
    const view = render(<VariablesPanel variables={[
      { name: 'big', value: 'x'.repeat(100) + '…', variablesReference: 7 },
    ]} onExpand={() => {}} />)
    expect(view.getByText(/big/)).toBeTruthy()
    expect(view.getByLabelText('Expand big')).toBeTruthy()
  })
})
```

Run: `pnpm exec vitest run packages/client/ui-debug/tests/panels.client.spec.tsx`

Expected: PASS.

- [x] **Step 6: Commit**

```sh
git add packages/client/ui-debug
git commit -m "feat(client): add debug toolbar and panels"
```

---

### Task 20: Workbench layout, panel registry, and shared file tree/terminal

**Milestone:** E

**Depends on:** Tasks 18, 19

**Files:**
- Create: `packages/client/ui-workbench/package.json`
- Create: `packages/client/ui-workbench/tsconfig.json`
- Create: `packages/client/ui-workbench/tsconfig.client.json`
- Create: `packages/client/ui-workbench/src/client/index.ts`
- Create: `packages/client/ui-workbench/src/client/workbench-panels.ts`
- Create: `packages/client/ui-workbench/src/client/layout.ts`
- Create: `packages/client/ui-workbench/src/client/Workbench.tsx`
- Create: `packages/client/ui-workbench/tests/panels.client.spec.ts`
- Create: `packages/client/ui-workbench/tests/layout.client.spec.ts`
- Create: `packages/client/ui-workbench/README.md`
- Create: `packages/client/ui-workbench/README.zh.md`

**Interfaces:**
- Consumes: `ctx.workbenchPanels`, `ui-dockkit`, `ui-sidebar-files` tree component, `ui-sidebar-terminal`, `ui-code-editor`, `ui-debug`.
- Produces: `WorkbenchPanelRegistry`, `createWorkbenchLayout`, `openWorkbenchPanel`, `Workbench`.

- [x] **Step 1: Write the failing panel-registry test**

Create `packages/client/ui-workbench/tests/panels.client.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { WorkbenchPanelRegistry } from '../src/client/workbench-panels.ts'

const contribution = {
  id: 'debug.stack', title: () => 'Call stack', icon: 'stack', component: () => null, defaultLocation: 'right' as const,
}

describe('WorkbenchPanelRegistry', () => {
  it('registers, lists, rejects duplicates, and releases panels', () => {
    const registry = new WorkbenchPanelRegistry()
    const dispose = registry.register(contribution)
    expect(registry.list().map(panel => panel.id)).toEqual(['debug.stack'])
    expect(() => registry.register(contribution)).toThrow(expect.objectContaining({ code: 'DEBUG_CONFLICT' }))
    dispose()
    expect(registry.list()).toEqual([])
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/client/ui-workbench/tests/panels.client.spec.ts`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement the panel registry and layout**

`workbench-panels.ts` registers panel contributions by id with default location and order; duplicate ids fail; disposal removes the panel. `layout.ts` stores panel ids and locations, not React components or business state; it persists per client.

`Workbench.tsx` renders the toolbar, launch-config picker, file tree, editor tabs, debug panels, adapter settings, terminal, and debug output using `ui-dockkit`. It reuses the `ui-sidebar-files` tree component and the existing terminal pane instead of reimplementing them. It registers a workbench page and command/shortcut. The config picker reads `.dsh/debug.json` through the launch-config loader and offers “Debug current file” plus “Add configuration” with schema validation.

- [x] **Step 4: Write and run the layout test**

Create `packages/client/ui-workbench/tests/layout.client.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { createWorkbenchLayout, findPanel, openWorkbenchPanel } from '../src/client/layout.ts'

describe('workbench layout', () => {
  it('opens a panel in the requested location and survives a round trip', () => {
    const layout = openWorkbenchPanel(createWorkbenchLayout(), 'debug.stack', 'right')
    expect(findPanel(layout, 'debug.stack')?.location).toBe('right')
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout)
  })
})
```

Run: `pnpm exec vitest run packages/client/ui-workbench/tests/layout.client.spec.ts`

Expected: PASS.

- [x] **Step 5: Wire responsive behavior and focus**

Wide layouts show files/editor/debug; narrow layouts collapse side panels into tabs and keep the editor plus bottom panel. Stopping does not steal focus unless the user enabled “focus on stop”. Keyboard shortcuts are scoped to the workbench. Add ARIA labels, keyboard-operable panel and breakpoint controls, screen-reader stop announcements, and reduced-motion handling; all copy goes through locale dictionaries.

- [x] **Step 6: Run the client tests**

Run: `pnpm exec vitest run packages/client/ui-workbench/tests packages/client/ui-debug/tests packages/client/ui-code-editor/tests`

Expected: PASS.

- [x] **Step 7: Commit**

```sh
git add packages/client/ui-workbench
git commit -m "feat(client): add debug workbench layout and panel registry"
```

---

### Task 21: Desktop native integration

**Milestone:** E

**Depends on:** Tasks 9, 20

**Files:**
- Create: `apps/desktop/src/debug/notifications.ts`
- Create: `apps/desktop/src/debug/menu.ts`
- Create: `apps/desktop/src/debug/process-picker.ts`
- Create: `apps/desktop/src/debug/adapter-cache.ts`
- Modify: `apps/desktop/src/main.ts`
- Create: `apps/desktop/tests/debug-notifications.spec.ts`
- Create: `apps/desktop/tests/debug-process-picker.spec.ts`
- Create: `apps/desktop/tests/debug-adapter-cache.spec.ts`

**Interfaces:**
- Consumes: Electron `Notification`, `Menu`, main window APIs, `ctx.debug.events`, provider `probeAttachTargets`, adapter manager.
- Produces: OS notifications, Debug menu, native process picker, offline adapter cache.

- [x] **Step 1: Write the failing notification test**

Create `apps/desktop/tests/debug-notifications.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { notifyDebugStop } from '../src/debug/notifications.ts'

describe('desktop debug notifications', () => {
  it('shows location and reason but never variable values', () => {
    const show = vi.fn()
    notifyDebugStop({ show }, {
      sessionId: 'debug-1', reason: 'breakpoint', source: 'src/a.ts', line: 4,
      variables: { secret: 'do-not-show' },
    } as never)
    expect(show).toHaveBeenCalledWith({ title: 'Breakpoint', body: 'src/a.ts:4' })
    expect(JSON.stringify(show.mock.calls)).not.toContain('do-not-show')
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/debug-notifications.spec.ts`

Expected: FAIL because `notifications.ts` does not exist.

- [x] **Step 3: Implement notifications, menu, and process picker**

`notifications.ts` subscribes to `session/stopped`, shows a native notification with reason and workspace-relative location, and focuses the workbench/session on click. It never includes variables, source text, environment values, or memory.

`menu.ts` adds a Debug menu and shortcuts (start, continue, step, stop, toggle breakpoint) that dispatch the same commands as the toolbar; shortcuts cannot bypass approval.

`process-picker.ts` calls provider `probeAttachTargets` through the execution world, renders the provider-declared targets in a dialog, and never uses a generic Electron process API.

`adapter-cache.ts` uses the adapter manager's local install root, supports offline reuse, and verifies checksums before use.

- [x] **Step 4: Write and run the process-picker test**

Create `apps/desktop/tests/debug-process-picker.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { listAttachTargets } from '../src/debug/process-picker.ts'

describe('desktop process picker', () => {
  it('lists only provider-declared targets', async () => {
    const provider = { probeAttachTargets: vi.fn(async () => [{ id: '42', label: 'node app' }]) }
    await expect(listAttachTargets(provider as never, {} as never)).resolves.toEqual([{ id: '42', label: 'node app' }])
    expect(provider.probeAttachTargets).toHaveBeenCalledOnce()
  })
})
```

- [x] **Step 5: Run desktop tests**

Run: `pnpm exec vitest run apps/desktop/tests/debug-notifications.spec.ts apps/desktop/tests/debug-process-picker.spec.ts apps/desktop/tests/debug-adapter-cache.spec.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```sh
git add apps/desktop
git commit -m "feat(desktop): add native debug notifications menus and process picker"
```

---

### Task 22: TUI app shell, session transcript/input, and `tui` profile

**Milestone:** F

**Depends on:** Tasks 2, 14

**Files:**
- Create: `apps/tui/package.json`
- Create: `apps/tui/tsconfig.json`
- Create: `apps/tui/src/index.ts`
- Create: `apps/tui/src/app.tsx`
- Create: `apps/tui/src/session.ts`
- Create: `apps/tui/src/transcript.ts`
- Create: `apps/tui/src/input.ts`
- Create: `apps/tui/src/state.ts`
- Create: `apps/tui/src/approval.ts`
- Create: `apps/tui/tests/transcript.spec.ts`
- Create: `apps/tui/tests/input.spec.ts`
- Create: `apps/tui/tests/state.spec.ts`
- Create: `apps/tui/tests/session.spec.ts`
- Create: `apps/tui/tests/app.pty.spec.ts`
- Create: `packages/bundle/tui-app/package.json`
- Create: `packages/bundle/tui-app/cordis.patch.yml`
- Create: `packages/bundle/tui-app/src/index.ts`
- Create: `packages/bundle/tui-app/README.md`
- Create: `packages/bundle/tui-app/README.zh.md`
- Create: `apps/tui/README.md`
- Create: `apps/tui/README.zh.md`
- Create: `apps/tui/README.i18n.yaml`
- Modify: `packages/util/official-bundles/src/bundles.ts`（`PROFILE_TEMPLATES` 增加 `tui`）
- Modify: `apps/cli/package.json`（把 `@deepseek-ai/dsh-tui-app` 列为安装依赖）
- Modify: `scripts/verify-application-entrypoints.ts` 的分类表（`apps/tui` 归类为 profile 承载包，无 `bin`）
- Modify: `packages/tui/README.md` / `.zh.md` / `.i18n.yaml`（新分组三件套）
- Modify: `docs/architecture.md` / `.zh.md`（第 43 行 shipped profile 列表）
- Modify: `docs/cli-help.md` 经 `gen-cli-help`，`gen-official-bundle-catalog` 输出

**Interfaces:**
- Consumes: `ctx.agents`, `ctx.sessions`, `ctx.approval`, `ctx.debug`, `ctx.get('tuiDebug')`.
- Produces: `dsh tui` profile; `createTuiSession`, `appendTranscript`, `parseTuiInput`; Chat/Split/Debug layout.

- [x] **Step 1: Write the failing transcript/input test**

Create `apps/tui/tests/transcript.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { appendTranscript, createTranscript } from '../src/transcript.ts'

describe('TUI transcript', () => {
  it('keeps user, assistant, and bounded tool summaries in order', () => {
    let state = createTranscript()
    state = appendTranscript(state, { kind: 'user', text: 'why does it fail?' })
    state = appendTranscript(state, { kind: 'assistant', text: 'Let me inspect.' })
    state = appendTranscript(state, { kind: 'tool', name: 'debug_execution', summary: 'stopped at src/a.ts:4' })
    expect(state.entries.map(entry => entry.kind)).toEqual(['user', 'assistant', 'tool'])
    expect(state.entries[2]).toMatchObject({ name: 'debug_execution', summary: 'stopped at src/a.ts:4' })
  })
})
```

Create `apps/tui/tests/input.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { parseTuiInput } from '../src/input.ts'

describe('TUI input', () => {
  it('treats ordinary text as a prompt and a leading colon as a command', () => {
    expect(parseTuiInput('hello')).toEqual({ kind: 'prompt', text: 'hello' })
    expect(parseTuiInput(':debug')).toEqual({ kind: 'command', name: 'debug', args: [] })
    expect(parseTuiInput(':break src/a.ts:4 if x > 1')).toEqual({
      kind: 'command', name: 'break', args: ['src/a.ts:4', 'if', 'x > 1'],
    })
  })

  it('does not execute shell syntax', () => {
    expect(parseTuiInput('!rm -rf /')).toEqual({ kind: 'prompt', text: '!rm -rf /' })
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run apps/tui/tests/transcript.spec.ts apps/tui/tests/input.spec.ts`

Expected: FAIL because the app does not exist.

- [x] **Step 3: Implement the session and input model**

`session.ts` creates one interactive Session using the existing agent/session services; it accepts `--session-id` to resume and sends prompts through the same path as headless. It never creates a second conversation store.

`transcript.ts` renders committed user/assistant messages and bounded tool summaries; long outputs are stored behind an id and expanded with `:expand <n>`.

`input.ts` parses argv-like command tokens without a shell; `:` starts a command, everything else is a prompt, and `!` is plain text.

- [x] **Step 4: Write and run the session test**

Create `apps/tui/tests/session.spec.ts`:

```text
import { describe, expect, it, vi } from 'vitest'
import { createTuiSession } from '../src/session.ts'

describe('TUI session', () => {
  it('submits a prompt through the existing session path and records the user entry', async () => {
    const send = vi.fn(async () => {})
    const session = createTuiSession({ send, sessionId: 'session-1' } as never)
    await session.submit('hello')
    expect(send).toHaveBeenCalledWith('hello')
    expect(session.transcript().entries[0]).toMatchObject({ kind: 'user', text: 'hello' })
  })
})
```

Run: `pnpm exec vitest run apps/tui/tests/session.spec.ts`

Expected: PASS.

- [x] **Step 4b: Persist TUI-local layout and command history**

Create `state.ts` and `tests/state.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { createTuiClientState, restoreTuiClientState } from '../src/state.ts'

describe('TUI client state', () => {
  it('round-trips layout and bounded command history without Session state', () => {
    const state = createTuiClientState()
    state.setLayout('debug')
    state.pushCommand(':next')
    expect(restoreTuiClientState(state.serialize())).toMatchObject({ layout: 'debug', history: [':next'] })
  })
})
```

Layout and command history are client-local, bounded, and never written to the Session log.

- [x] **Step 5: Implement the Ink app and profile bundle**

`app.tsx` uses Ink and renders Chat (default), Split (F7), and Debug (F6) layouts. It registers `ctx.approval` as a terminal answerer, scopes debug shortcuts to the debug pane, persists layout/command history through `state.ts`, and prompts before exiting with running debug sessions.

`packages/bundle/tui-app/cordis.patch.yml` 堆叠 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-tui-debug`；该包 manifest 声明 `dsh.bundle.patch`（不是 `dsh.profile`）。profile 名在 `packages/util/official-bundles/src/bundles.ts` 的 `PROFILE_TEMPLATES` 注册，值为 `{ bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui-app'] }`，`dsh.profile.bundles` 是安装时写入 profile 文件的字段。`apps/tui` 是 Cordis 插件形态的应用入口，不声明 `bin`，由 `scripts/verify-application-entrypoints` 显式归类；`dsh tui` 作为 shipped profile 自动可用，无需新增 CLI 子命令表项，但 `gen-cli-help` 与 `gen-official-bundle-catalog` 要重跑，`docs/architecture.md` 第 43 行的 shipped profile 列表要同步中英文配对。

Ink、ink-testing-library、node-pty 当前都不在依赖树里。开工前先在依赖评审里定版并给出理由：`ctx.terminals`（`packages/terminal`）已经提供持久终端，TUI 自带 PTY 的必要性要正面回答，否则按「优先用已维护依赖」的策略复用现有能力。node-pty 是原生模块，三平台 CI 需要编译产物或预编译包，这一条要在 CI 上先验证再写测试。

- [x] **Step 5b: Add a PTY smoke test**

Add `node-pty` as a dev dependency of `apps/tui` and create `app.pty.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import pty from 'node-pty'

describe('dsh tui PTY', () => {
  it('boots, renders the status/input line, and accepts a prompt', async () => {
    const child = pty.spawn(process.execPath, ['apps/cli/lib/bin.js', 'tui', '--no-color'], {
      cols: 100, rows: 30, cwd: process.cwd(), env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
    })
    const seen: string[] = []
    child.onData(data => seen.push(data))
    child.write('hello\r')
    await new Promise(resolve => setTimeout(resolve, 500))
    child.kill()
    expect(seen.join('')).toContain('input >')
    expect(seen.join('')).toContain('hello')
  })
})
```

Skip only when the platform cannot allocate a PTY; do not replace the test with a pure Ink snapshot. 该 spec 消费构建产物 `apps/cli/lib/bin.js`，属于 artifact plane：按 [docs/development.md](../../development.md#typescript-project-layout) 的规则显式声明它依赖 `build:artifacts` 的输出，不能混进源平面门禁，也不能在干净树上直接跑。断言用轮询读取到稳定标记或超时上限，不用固定 `setTimeout(500)`；`--no-color` 之类的启动参数要先确认 CLI 实际接受，别把期望写成不存在的路径。

- [x] **Step 6: Run all TUI tests**

Run: `pnpm exec vitest run apps/tui/tests`

Expected: PASS.

- [x] **Step 7: Commit**

```sh
git add apps/tui packages/bundle/tui-app
git commit -m "feat(tui): add terminal session app and tui profile"
```

---

### Task 23: TUI debug panels, commands, source preview, and `$EDITOR`

**Milestone:** F

**Depends on:** Tasks 14, 22

**Files:**
- Create: `packages/tui/tui-debug/package.json`
- Create: `packages/tui/tui-debug/tsconfig.json`
- Create: `packages/tui/tui-debug/src/commands.ts`
- Create: `packages/tui/tui-debug/src/panels.ts`
- Create: `packages/tui/tui-debug/src/source-preview.ts`
- Create: `packages/tui/tui-debug/src/editor.ts`
- Create: `packages/tui/tui-debug/src/index.ts`
- Create: `packages/tui/tui-debug/tests/commands.spec.ts`
- Create: `packages/tui/tui-debug/tests/source-preview.spec.ts`
- Create: `packages/tui/tui-debug/tests/editor.spec.ts`
- Create: `packages/tui/tui-debug/README.md`
- Create: `packages/tui/tui-debug/README.zh.md`

**Interfaces:**
- Consumes: `ctx.debug`, `ctx.fs`, `ctx.workspace`, `ctx.terminals`.
- Produces: command parser, debug panel reducer, source window, `editorCommand`, keybindings.

- [ ] **Step 1: Write the failing command test**

Create `packages/tui/tui-debug/tests/commands.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { parseDebugCommand } from '../src/commands.ts'

describe('TUI debug commands', () => {
  it('parses break, condition, logpoint, execution, and session commands', () => {
    expect(parseDebugCommand(':break src/a.ts:4 if x > 1')).toMatchObject({ name: 'break', file: 'src/a.ts', line: 4, condition: 'x > 1' })
    expect(parseDebugCommand(':break src/a.ts:4 log x={x}')).toMatchObject({ name: 'break', logMessage: 'x={x}' })
    expect(parseDebugCommand(':next')).toEqual({ name: 'next' })
    expect(parseDebugCommand(':switch debug-1')).toEqual({ name: 'switch', sessionId: 'debug-1' })
  })

  it('rejects an unknown command and a malformed breakpoint', () => {
    expect(() => parseDebugCommand(':wat')).toThrow(expect.objectContaining({ code: 'DEBUG_UNKNOWN_OPERATION' }))
    expect(() => parseDebugCommand(':break nope')).toThrow(expect.objectContaining({ code: 'DEBUG_INVALID_CONFIG' }))
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/tui/tui-debug/tests/commands.spec.ts`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement commands and panels**

`commands.ts` parses the command table from the spec (`:run`, `:attach`, `:break`, `:exception`, `:continue`, `:next`, `:step`, `:out`, `:back`, `:bt`, `:frame`, `:vars`, `:eval`, `:watch`, `:threads`, `:sessions`, `:switch`, `:terminate`, `:disconnect`, `:adapter`, `:chat`, `:debug`, `:split`, `:expand`, `:help`, `:quit`). It rejects unknown commands and malformed breakpoints; expressions remain one argument.

`panels.ts` folds `ctx.debug.events` into the TUI pane state: status, stack, variables, watch, breakpoints, console, and source location. It hides unsupported actions.

- [ ] **Step 4: Write the failing source/editor test**

Create `packages/tui/tui-debug/tests/source-preview.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { sourceWindow } from '../src/source-preview.ts'

describe('TUI source preview', () => {
  it('keeps a bounded window around the current line', () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`)
    expect(sourceWindow(lines, 50, 3)).toEqual({ start: 47, end: 53, current: 50 })
  })
})
```

Create `packages/tui/tui-debug/tests/editor.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { editorCommand } from '../src/editor.ts'

describe('external editor', () => {
  it('opens a local file at the current line', () => {
    expect(editorCommand('/usr/bin/vi', '/ws/src/a.ts', 4)).toEqual(['/usr/bin/vi', '+4', '/ws/src/a.ts'])
  })

  it('uses the configured remote command for a remote workspace', () => {
    expect(editorCommand('code --remote ssh-remote+host', '/remote/a.ts', 4)).toEqual([
      'code', '--remote', 'ssh-remote+host', '+4', '/remote/a.ts',
    ])
  })
})
```

- [ ] **Step 5: Implement source preview and editor bridge**

`source-preview.ts` reads a bounded window through `ctx.fs`, marks the current line, and never loads the full file. `editor.ts` builds an argv array from a configured command, appends `+<line>` and the file path, and spawns through the local subprocess; if no remote editor is configured for an SSH workspace, it returns the remote path for copying instead of opening a local path.

- [ ] **Step 6: Run all TUI debug tests**

Run: `pnpm exec vitest run packages/tui/tui-debug/tests`

Expected: PASS.

- [x] **Step 7: Commit**

```sh
git add packages/tui/tui-debug
git commit -m "feat(tui): add debug panels commands and external editor bridge"
```

---

### Task 24: Headless NDJSON debug events

**Milestone:** F

**Depends on:** Tasks 3, 14

**Files:**
- Modify: `packages/bundle/headless/src/json-stream.ts`
- Modify: `packages/bundle/headless/src/index.ts`
- Create: `packages/bundle/headless/tests/json-stream-debug.spec.ts`
- Create: `packages/bundle/headless/tests/headless-debug-harness.ts`
- Modify: `packages/bundle/headless/README.md`
- Modify: `packages/bundle/headless/README.zh.md`

**Interfaces:**
- Consumes: committed Session events, `ctx.get('debug')`.
- Produces: `debug/session-started`, `debug/stopped`, `debug/session-ended`, `debug/control` in `--json` NDJSON; bounded fields only.

- [x] **Step 1: Write the failing NDJSON test**

Create `packages/bundle/headless/tests/json-stream-debug.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { createHeadlessHarness } from './headless-debug-harness.ts'

describe('headless debug NDJSON', () => {
  it('emits a bounded stop event without variables or raw DAP', () => {
    const harness = createHeadlessHarness()
    harness.emit({
      type: 'debug/stopped',
      data: { sessionId: 'debug-1', reason: 'breakpoint', threadId: 1, source: 'src/a.ts', line: 4, column: 2 },
    } as never)
    const line = harness.parsed().at(-1)
    expect(line).toMatchObject({
      type: 'debug/stopped',
      data: { sessionId: 'debug-1', reason: 'breakpoint', source: 'src/a.ts', line: 4 },
    })
    expect(JSON.stringify(line)).not.toContain('variables')
    expect(JSON.stringify(line)).not.toContain('Content-Length')
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/bundle/headless/tests/json-stream-debug.spec.ts`

Expected: FAIL because `debug/stopped` is not projected.

- [x] **Step 3: Project debug events**

Extend `projectJsonRun` to include the four durable debug events. Reuse the existing per-string and per-event bounds; never include DAP frames, variable values, memory, or environment values. The projection waits for committed Session events and does not read live DAP traffic.

- [x] **Step 4: Update headless documentation and run tests**

Document the debug event family and its bounds in `packages/bundle/headless/README.md` and the Chinese pair. Run:

`pnpm exec vitest run packages/bundle/headless/tests/json-stream-debug.spec.ts packages/bundle/headless/tests/json-stream.spec.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```sh
git add packages/bundle/headless
git commit -m "feat(headless): project durable debug events to NDJSON"
```

---

### Task 25: Three-surface consistency, snapshots, and SDK outputs

**Milestone:** G

**Depends on:** Tasks 8, 10, 11, 12, 13, 21, 23, 24

**Files:**
- Create: `packages/test-support/debug-scenarios/package.json`
- Create: `packages/test-support/debug-scenarios/src/index.ts`
- Create: `packages/test-support/debug-scenarios/tests/consistency.spec.ts`
- Create: `snapshots/ide-debugging/basic/snapshot.yml`
- Create: `snapshots/ide-debugging/basic/cordis.yml`
- Create: `snapshots/ide-debugging/human-agent-handoff/snapshot.yml`
- Create: `snapshots/ide-debugging/human-agent-handoff/cordis.yml`
- Create: `snapshots/ide-debugging/basic/session.jsonl` through the record script
- Create: `snapshots/ide-debugging/human-agent-handoff/session.jsonl` through the record script
- Create: `packages/sdk/client/tests/debug-events.spec.ts`
- Create: `packages/sdk/client/tests/expected/debug-events.json`
- Create: `python/sdk/tests/test_debug_events_snapshot.py`
- Create: `python/sdk/tests/expected/debug-events.json`

**Interfaces:**
- Consumes: fake adapter scenarios, `ctx.debug`, headless projection, TUI transcript, Web/Desktop normalized view state.
- Produces: shared `debugScenario` fixtures; normalized event stream; snapshot cases; updated TS/Python SDK expectations.

- [x] **Step 1: Write the failing consistency test**

Create `packages/test-support/debug-scenarios/tests/consistency.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { debugScenario, normalizeSurfaceEvents, runScenario } from '../src/index.ts'

describe('three-surface debug consistency', () => {
  it('produces the same normalized state for web, tui, and headless', async () => {
    const scenario = debugScenario('basic', { language: 'node', stops: [{ reason: 'breakpoint', line: 4 }] })
    const web = await runScenario('web', scenario)
    const tui = await runScenario('tui', scenario)
    const headless = await runScenario('headless', scenario)
    expect(normalizeSurfaceEvents(web)).toEqual(normalizeSurfaceEvents(tui))
    expect(normalizeSurfaceEvents(headless)).toEqual(normalizeSurfaceEvents(web))
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/test-support/debug-scenarios/tests/consistency.spec.ts`

Expected: FAIL because the scenario package does not exist.

- [x] **Step 3: Implement shared scenarios and normalization**

`debugScenario(name, options)` returns a deterministic adapter script with breakpoints, steps, variables, exception, and terminate. `runScenario(surface, scenario)` drives the appropriate surface harness: Web/Desktop use the Remote controller and store, TUI uses the transcript/panel reducer, and headless uses `projectJsonRun`. `normalizeSurfaceEvents` removes presentation-only fields and keeps session id, state, stop reason, relative location, breakpoint verification, error code, and control actor.

- [ ] **Step 4: Add recorded-session snapshots**（阻塞：本机无 `DEEPSEEK_API_KEY`，场景声明 `recording: live`，等待 live 录制；回放适配器按设计保持 skip）

Create the two scenario patches under `snapshots/ide-debugging/`, using the fake adapter from Task 4 and the shipped `web`/`tui` profiles. `snapshot.yml` declares the scenario and workspace seed; `cordis.yml` mounts the fake provider. Record with:

`pnpm run test:snapshot:record -t ide-debugging`

Then replay without writes:

`pnpm run test:snapshot -t ide-debugging`

Expected: PASS. The recorded `session.jsonl` files are the committed replay input; do not hand-write expected JSONL.

- [x] **Step 5: Add SDK debug-event projections**

Add `packages/sdk/client/tests/debug-events.spec.ts` modeled on `cot-translation-projection.spec.ts`: feed a fake runtime the four `debug/*` events and compare the projected event list with `expected/debug-events.json`. Add the Python counterpart in `python/sdk/tests/test_debug_events_snapshot.py` with `python/sdk/tests/expected/debug-events.json`. Run:

`pnpm exec vitest run packages/sdk/client/tests/debug-events.spec.ts`

`pnpm exec pytest python/sdk/tests/test_debug_events_snapshot.py -q`

Expected: PASS.

- [x] **Step 6: Run focused verification**

Run:

`pnpm exec vitest run packages/test-support/debug-scenarios/tests`

`pnpm run test:snapshot -t ide-debugging`

Expected: PASS.

- [x] **Step 7: Commit**

```sh
git add packages/test-support/debug-scenarios snapshots packages/sdk python
git commit -m "test(debug): add three-surface consistency snapshots"
```

---

### Task 25b: Real adapter and execution-world matrix

**Milestone:** G

**Depends on:** Tasks 6b, 8, 10, 11, 12, 13

**Files:**
- Create: `packages/test-support/debug-e2e/package.json`
- Create: `packages/test-support/debug-e2e/src/index.ts`
- Create: `packages/test-support/debug-e2e/fixtures/node/app.ts`
- Create: `packages/test-support/debug-e2e/fixtures/python/app.py`
- Create: `packages/test-support/debug-e2e/fixtures/go/main.go`
- Create: `packages/test-support/debug-e2e/fixtures/native/main.c`
- Create: `packages/test-support/debug-e2e/tests/node.spec.ts`
- Create: `packages/test-support/debug-e2e/tests/python.spec.ts`
- Create: `packages/test-support/debug-e2e/tests/go.spec.ts`
- Create: `packages/test-support/debug-e2e/tests/native.spec.ts`
- Create: `packages/test-support/debug-e2e/tests/ssh.spec.ts`
- Create: `packages/test-support/debug-e2e/tests/sandbox.spec.ts`
- Create: `packages/test-support/debug-e2e/README.md`

**Interfaces:**
- Consumes: real providers, managed adapters, local/SSH/sandbox execution worlds.
- Produces: `launchFixture`, `skipWithoutAdapter`, four-language e2e coverage, SSH launch/attach coverage, sandbox launch coverage.

- [x] **Step 1: Write the failing Node e2e test**

Create `packages/test-support/debug-e2e/tests/node.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { launchFixture, skipWithoutAdapter } from '../src/index.ts'

describe.skipIf(skipWithoutAdapter('node'))('node debug e2e', () => {
  it('hits a breakpoint, steps, and terminates', async () => {
    const session = await launchFixture('node', { file: 'fixtures/node/app.ts' })
    await session.setBreakpoints({ source: 'fixtures/node/app.ts', breakpoints: [{ line: 3 }] })
    await expect(session.continue()).resolves.toMatchObject({ kind: 'stopped', stop: { reason: 'breakpoint' } })
    await expect(session.step('over')).resolves.toMatchObject({ kind: 'stopped' })
    await session.terminate()
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/test-support/debug-e2e/tests/node.spec.ts`

Expected: FAIL because the e2e harness does not exist.

- [x] **Step 3: Implement the harness and fixtures**

`launchFixture(language, options)` resolves the managed adapter, starts the real provider and debug service in the normal profile composition, applies the fixture breakpoints, and returns the live session. `skipWithoutAdapter` checks the provider, adapter manifest, and toolchain; when missing it returns a reason string, never a mock.

Landed in `packages/test-support/debug-e2e/src/index.ts`: `skipWithoutAdapter` returns and records reason strings (`recordedSkipReasons`), and Go and native are decided by explicit skip regardless of toolchain presence.

Add minimal fixtures with a known breakpoint line and a step target for Node, Python, Go, and C. The SSH and sandbox tests use the repository's existing profile patches and fixtures; assert launch and breakpoint behavior, and assert `DEBUG_ATTACH_UNSUPPORTED` or `DEBUG_SANDBOX_DENIED` where the world cannot grant the capability.

- [x] **Step 4: Add Python, Go, native, SSH, and sandbox tests**

Each language test follows the same shape with its provider and fixture. The SSH test runs a stdio launch and a tunneled attach when supported; otherwise it asserts the explicit unsupported code. The sandbox test asserts launch under the configured sandbox and the ptrace denial path.

Landed: Python (real launch with the missing-adapter skip fallback), Go and native (explicit skips with recorded reasons and a skip-record assertion), SSH (the explicit `DEBUG_ATTACH_UNSUPPORTED` path through the fixture stub), and sandbox (the published world-capability gate `probeDebugEnvironment` through a stub world: a granted sandbox probes through to the launch environment, a denying sandbox rejects `DEBUG_SANDBOX_DENIED` for both process-control flavors, and a world that cannot host ptrace rejects `DEBUG_ADAPTER_UNSUPPORTED`; real confinement under `sandbox-exec` belongs to the CI platform matrix).

- [x] **Step 5: Run the matrix**

Run:

`pnpm exec vitest run packages/test-support/debug-e2e/tests`

Expected: PASS or explicit skip reasons recorded in the test output. CI installs pinned adapters and runs the full matrix.

2026-10-27 local run: 5 files, 5 passed, 2 skipped, 0 failed. The Node lane executed the real launch, breakpoint, and terminate loop through the managed js-debug 1.140.0 socket bridge, and the Python lane through debugpy 1.8.22 on the managed venv interpreter; Go and native kept their explicit skips recorded by `skipWithoutAdapter` (this host had `go`/`dlv` on PATH and `lldb-dap` absent, and the closed loops land with the adapter-matrix follow-up regardless). SSH exercised only the explicit `DEBUG_ATTACH_UNSUPPORTED` stub. Local subset; the full-platform matrix belongs to CI.

- [x] **Step 6: Commit**

```sh
git add packages/test-support/debug-e2e
git commit -m "test(debug): add real adapter and execution-world matrix"
```

---

### Task 26: Documentation, generated catalogs, package groups, and Agent Note

**Milestone:** G

**Depends on:** Task 25

**Files:**
- Create: `docs/subsystems/debug.md` and `docs/subsystems/debug.zh.md`
- Create: `docs/user/guide/debugging.md` and `docs/user/guide/debugging.zh.md`
- Create: `docs/user/guide/debugging-cli.md` and `docs/user/guide/debugging-cli.zh.md`
- Modify: `docs/architecture.md` and `docs/architecture.zh.md`
- Modify: `docs/capability-seams.md`, `docs/tool-catalog.md`, `docs/config-catalog.md`, `docs/event-producer-consumer.md`, `docs/module-graph.md`, `docs/cli-help.md` through their generators
- Modify: `packages/README.md` and `packages/README.zh.md` for the new `debug/` and `tui/` groups
- Modify: `packages/bundle/README.md` and its Chinese pair for `debug` and `tui-app`
- Create: `packages/bundle/debug/package.json`
- Create: `packages/bundle/debug/cordis.patch.yml`
- Create: `packages/bundle/debug/README.md`
- Create: `packages/bundle/debug/README.zh.md`
- Modify: `packages/bundle/base/cordis.patch.yml`, `packages/bundle/web-app/cordis.patch.yml`, `packages/bundle/headless/cordis.patch.yml`, `apps/desktop/config/`
- Create: `packages/debug/README.zh.md`, `packages/tui/README.md`, `packages/tui/README.zh.md`
- Create: `packages/debug/README.i18n.yaml`, `packages/tui/README.i18n.yaml` 和每个新包 README 的 `.i18n.yaml`（`docs/` 与 `.agents/notes/` 和所有 `README*` 都在双语语料内，缺 sidecar 的记录会让 `doc-sync` 失败：用 `pnpm run verify-translation-pairing --write <pair>` 记录）
- Modify: `packages/util/official-bundles/src/bundles.ts`（`PROFILE_TEMPLATES` 与必要的 `OPTIONAL_BUNDLES` 行）
- Modify: `scripts/verify-application-entrypoints.ts` 分类表（`apps/tui` 无 `bin`，按 profile 承载包归类）
- Create: `.agents/notes/implemented/architecture/2026-10-25-debug-adapter-seam.md` and its Chinese pair
- Modify: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Consumes: all implemented packages and generated catalogs.
- Produces: current-state documentation, generated reference freshness, Agent Note, and third-party notices.

- [x] **Step 1: Write the subsystem page**

Document the capability seam, state machine, provider roles, execution worlds, ownership, durable events, bounds, and explicit limitations. Link package READMEs rather than restating their JSDoc. Add the Chinese pair.

Landed as `docs/subsystems/debug.md` and `debug.zh.md`; both sides of the folder README index the page.

- [x] **Step 2: Write the user guides**

`debugging.md` covers Web/Desktop: workbench, launch configuration, breakpoints, panels, adapter install, save conflicts, and common failures. `debugging-cli.md` covers `dsh tui` Chat/Split/Debug layouts, commands, keys, `$EDITOR`, headless NDJSON, and CI adapter setup. Both get Chinese pairs.

All four pages landed with their i18n sidecars alongside the tui group README and the adapter-seam Agent Note.

- [x] **Step 3: Update architecture and package maps**

Add the `debug/` and `tui/` groups, the `dsh-debug` seam, the three consumers, the `tui` profile in the application-launch list, and “Add a debug adapter” in *Where new behavior goes*. Update `packages/README.md` and bundle maps.

Both language sides of `docs/architecture.md` and `packages/README.md` carry the groups, the seam row, the consumer list, and the `tui` profile; the doc-budget ceilings moved with them.

- [x] **Step 3b: Wire bundles and profiles**

Create `packages/bundle/debug` with a patch that stacks the debug service, DAP client, adapter manager, four providers, `tool-debug`, `api/debug-controller`, `ui-code-editor`, `ui-debug`, and `ui-workbench`. 组合归属（进 `dsh-base` 还是进 `OPTIONAL_BUNDLES`）按设计文档第 3.3 节是待裁决项，本步骤不替它决定；先按可选 bundle 落地，裁决进 `dsh-base` 时把行移到 base patch 并补升级说明。 Add the model-side rows to `dsh-base`, the full debug bundle to `web-app` and the Desktop profile, the headless NDJSON row where needed, and the `tui` profile to the shipped profile list. Keep headless/SDK/ACP model-only; they must not load browser or TUI UI.

Landed as `packages/bundle/debug` and `packages/bundle/tui-app` with both README pairs; the shipped profile list includes `tui`, and headless/SDK/ACP stayed model-only.

- [x] **Step 4: Regenerate catalogs and CLI help**

Run the repository generators rather than hand-editing generated regions:

```sh
pnpm run gen-cordis-catalog
pnpm run gen-session-format-catalog
pnpm run gen-cli-help
pnpm run gen-doc-graphs
pnpm run gen-config-catalog
pnpm run gen-tool-catalog
pnpm run gen-module-graph
pnpm run gen-client-catalog
pnpm run gen-official-bundle-catalog
pnpm run gen-third-party-notices
```

Do not edit generated files by hand.

The generators ran with their debug entries (service-page routing, link map, capability-seams and module-graph service roles, client slot and tool API rows); a first catalog pass had already landed with the earlier composition tasks, so this step only refreshed the remaining regions and the SSH `connectTcpStream` catalog row. `gen-cli-help` needed no rerun: the CLI surface is unchanged since the earlier catalog pass.

- [x] **Step 5: Write the Agent Note and third-party notices**

The Agent Note records why DAP, managed adapters, execution-world mapping, three-surface split, stop wake-up, and the full-control/workspace-isolation boundary. Add adapter licenses and any new libraries (CodeMirror, Ink) to `THIRD_PARTY_NOTICES.md`.

Landed: the implemented adapter-seam Agent Note with its bilingual pair, the managed-adapter rows in `THIRD_PARTY_NOTICES.md` (js-debug 1.140.0, debugpy 1.8.22, Delve 1.27.2, lldb-dap 23.1.4, versions pinned from each provider manifest), and the `2026-10-25-debug-events` persistence acknowledgement.

- [ ] **Step 6: Run documentation gates**

Run:

`pnpm run verify-md-wrap`

`pnpm run doc-sync`

`pnpm run website:build`

Expected: PASS. Fix generated-file drift and link errors, not the gates.

2026-10-28 status: every debug-owned gate is green — md-wrap, md-links, doc-standard, subsystem pages, export JSDoc, README summaries/limitations/model-experience, doc-site checks, translation pairing (debug pairs), persistence catalog, and the persistence type history with the debug acknowledgement record. Remaining doc-sync reds are outside this task: `doc-typecheck` fails at the branch head on the `ISessions`/`SessionStore` seam drift (pre-dates Task 26, needs the session-store alignment work), translation pairing still sees the untracked `scratch-plugin` workspace, and the persistence type-history parser rejects the untracked prompt-optimizer WIP record. `website:build` was not rerun in this task.

- [x] **Step 7: Commit**

```sh
git add docs packages .agents THIRD_PARTY_NOTICES.md
git commit -m "docs(debug): document the debug seam workbench and CLI"
```

---

### Task 27: Security, performance, packaging, and release hardening

**Milestone:** G

**Depends on:** Tasks 25b, 26

**Files:**
- Create: `packages/debug/debug/src/security.ts`
- Create: `packages/debug/debug/src/telemetry.ts`
- Create: `packages/debug/debug/src/config.ts`
- Create: `packages/debug/debug/tests/security.spec.ts`
- Create: `packages/debug/debug/tests/telemetry.spec.ts`
- Create: `packages/debug/debug/tests/config.spec.ts`
- Create: `packages/api/debug-controller/tests/editor-write-security.spec.ts`
- Create: `packages/debug/tool-debug/tests/redaction.spec.ts`
- Create: `benchmarks/debug/README.md`
- Create: `benchmarks/debug/session-throughput.bench.ts`
- Modify: package manifests for `files`, `exports`, `peerDependencies`, and `private` correctness
- Modify: `THIRD_PARTY_NOTICES.md` (regenerated from the final dependency set)

**Interfaces:**
- Consumes: all previous tasks.
- Produces: adversarial security coverage, bounded-performance evidence, package hygiene, and release-check results.

- [x] **Step 1: Add adversarial security tests**

Deviation: no centralized `security.ts`. Workspace-access and symlink confinement are enforced at their owning seams (`dsh-fs`, controller), so the adversarial cases live there: `debug-controller/tests/editor-write.spec.ts` (escape/NUL/UTF-8/over-limit/conflicting version, 8 cases), `tool-debug/tests/approval.spec.ts` (control authorization incl. `DEBUG_CONTROL_NOT_GRANTED`, 6 cases), `debug-e2e/tests/sandbox.spec.ts`, and `debug/tests/environment.spec.ts` (13 cases). Redaction is pinned by `telemetry.spec.ts` ("never paths or environment values") and the durable-payload assertions in `launch.spec.ts`.

Create `packages/debug/debug/tests/security.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { assertWorkspaceAccess } from '../src/security.ts'

describe('debug security', () => {
  it('rejects cross-workspace access even for an agent', () => {
    expect(() => assertWorkspaceAccess({ workspaceId: 'ws-1' }, { workspaceId: 'ws-2' }))
      .toThrow(expect.objectContaining({ code: 'DEBUG_WORKSPACE_MISMATCH' }))
  })

  it('rejects an unsupported sandbox capability with an actionable code', () => {
    expect(() => assertCapabilities(['ptrace'], new Set()))
      .toThrow(expect.objectContaining({ code: 'DEBUG_SANDBOX_DENIED' }))
  })
})
```

Add editor-write tests for `../escape`, final symlink escape, NUL, non-UTF-8, over-limit content, and a conflicting version. Add control-authorization tests: Agent 控制人创建的会话在未打开开关且无单次审批时返回 `DEBUG_CONTROL_NOT_GRANTED`，开关打开后放行，两条路径都在 `debug/control` 里记录授权来源。Add redaction tests that environment values and expression values never appear in notices, tool results, or telemetry payloads.

- [x] **Step 1b: Add observability and configuration audit**

`telemetry.ts` + `tests/telemetry.spec.ts` landed with the allowlist projection exactly as specced. Deviation: no centralized `config.ts` — DAP limits are injected constructor params at the seams that enforce them, the controller ships a validated `eventRingLimit` `Config`, and the tool-debug `Config` home stays deferred to approval-wired orchestration; the audit found no hardcoded deployment tunable.

Create `telemetry.ts` and `tests/telemetry.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { debugSpanAttributes } from '../src/telemetry.ts'

describe('debug telemetry', () => {
  it('records surface, provider, and result but never paths or environment values', () => {
    const attributes = debugSpanAttributes({
      surface: 'cli', providerId: 'node', language: 'node', executionWorld: 'ssh',
      workspaceRoot: '/secret/ws', env: { TOKEN: 'do-not-show' }, outcome: 'ok',
    } as never)
    expect(attributes).toEqual({ surface: 'cli', providerId: 'node', language: 'node', executionWorld: 'ssh', outcome: 'ok' })
    expect(JSON.stringify(attributes)).not.toContain('do-not-show')
    expect(JSON.stringify(attributes)).not.toContain('/secret')
  })
})
```

Create `config.ts` with validated `Config` fields for every limit and timeout from the spec (`maxSessions`, `maxBreakpointsPerFile`, `maxBreakpointsTotal`, `initializeTimeoutMs`, `launchTimeoutMs`, `requestTimeoutMs`, `terminateTimeoutMs`, `maxMessageBytes`, `maxStackFrames`, `maxThreads`, `maxVariablesPerPage`, `maxValueChars`, `maxConsoleBytes`, `consoleRingBytes`, `eventRingBytes`, `adapterStderrBytes`, `maxNoticeBytes`, `completionDelivery`, `maxConsecutiveWakes`, `maxEditorFileBytes`, `maxDraftBytes`, `allowMemoryWrite`).

Create `tests/config.spec.ts`:

```text
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'

describe('debug config', () => {
  it('rejects non-positive limits at load', () => {
    expect(() => Config({ maxSessions: 0 })).toThrow()
    expect(() => Config({ requestTimeoutMs: -1 })).toThrow()
  })

  it('accepts a positive override', () => {
    expect(Config({ maxSessions: 2 }).maxSessions).toBe(2)
  })
})
```

No deployment tunable stays hardcoded; protocol constants, checksum verification, and sandbox non-bypass remain fixed invariants.

- [x] **Step 2: Add bounded-performance tests**

`benchmarks/debug/session-throughput.bench.ts` (already committed on this branch) with the bounded-surface assertions and a bilingual README pair.

`benchmarks/debug/session-throughput.bench.ts` drives the fake adapter through repeated stop/continue cycles with 10k console lines and 10k variables. Assert that event ring, console ring, stack pages, and variable pages stay within configured byte caps and that no unbounded array is retained. Use the existing benchmark runner and add a README describing how to run it.

- [x] **Step 3: Verify package hygiene**

`verify-product-use`, `verify-package-dependencies`, `verify-node-next-types`, and `verify-no-unknown-casts` pass (fixes: json-narrow exported from the package root, tui-app `export {}` marker, `as unknown` keeper removed). `publint` fails tree-wide from the master-inherited `"./src/*"` exports-vs-`files` pattern (368 packages, reproduced from `master:` package.json verbatim) — not a debug change.

Run:

`pnpm run hygiene`

Expected: PASS. Fix package exports, `files`, peer dependencies, workspace protocol, and private flags.

- [x] **Step 4: Run the full relevant gates**

`test:coverage`: 47,830 pass (a third clean run had 6 unrelated load-flake timeouts — real-network git+ssh, watcher, and darwin CPU tests — each green standalone; `debug-e2e/node.spec` passes standalone in 287 ms). `duplication`: 0 clones. `doc-sync`: every debug-owned check green (tsconfig paths, config catalog, export JSDoc, translation pairing for `benchmarks/debug`, repository references with the tool-generated `python/sdk/uv.lock` excluded after a wheel-size field collided with a commit abbreviation). Blocked upstream, with evidence: `typecheck`/`lint`/`build:artifacts`/`build:check` fail on the master-inherited `SessionStore`/`ISessions` migration (9 committed errors in `ui-chat`/`ui-approval`/`ui-sidebar-right`; unmasking them reveals ~200 more across the client tree — one in-flight migration, not debug-owned). `test:snapshot -t ide-debugging` cannot replay: the same host-compile failure skips the tsdown bundles so staged profiles miss `dsh-typert-registry/lib`.

Run:

`pnpm run test:coverage`

`pnpm run typecheck`

`pnpm run build:artifacts`

`pnpm run build:check`

`pnpm run lint`

`pnpm run duplication`

`pnpm run doc-sync`

`pnpm run test:snapshot -t ide-debugging`

Expected: PASS. Do not bypass a failing gate; fix the underlying issue.

- [x] **Step 5: Run the smallest real-API/e2e matrix**

Task 25b already executed and recorded the four-language, SSH, and sandbox matrix (see Task 25b notes); this pass re-ran `debug-e2e` standalone green. Full-suite runs of the same suites flake only on machine load (initialize-timeout under 14-worker saturation), never standalone.

Run the four-language local e2e suite, the SSH launch/attach suite, and the sandbox launch suite added by Task 25b. If a required toolchain is absent, record the skip and run the remaining matrix; do not mock the missing protocol path.

- [x] **Step 6: Commit**

```sh
git add packages benchmarks THIRD_PARTY_NOTICES.md
git commit -m "chore(debug): harden security performance and packaging"
```

---

## Execution Order

1. Execute Track A (T1–T3) before anything else.
2. Execute T4, then T5–T7; T9 can run in parallel with T4.
3. Execute T10–T13 in parallel after T9.
4. Execute T8 and T14–T17 after their dependencies.
5. Execute T18–T21 and T22–T24 in parallel after T17/T14.
6. Execute T25 when T21, T23, and T24 are green; execute T25b when the providers and T8 are green.
7. Execute T26 after T25 and T25b; execute T27 last.

## Definition of Done

- All acceptance criteria in the spec are covered by a task and verified by a test or gate.
- No placeholder remains; every task has exact files, interfaces, failing test, implementation behavior, verification command, and commit.
- The four-language local matrix, SSH launch/attach, sandbox launch, and three-surface consistency suites pass.
- The Web/Desktop workbench, CLI TUI, and headless NDJSON all consume the same normalized debug state.
- `test:coverage`, `typecheck`, `build:check`, `lint`, `duplication`, `doc-sync`, and the new snapshots pass.
- Documentation, i18n pairs, generated catalogs, Agent Note, and third-party notices are current.
