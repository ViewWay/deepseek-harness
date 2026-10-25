# DeepSeek Harness IDE 级调试能力设计

- 状态：已评审（2026-10-25 评审完成，裁决与修正记录见第 21 节）
- 日期：2026-10-25
- 范围：在 Harness 内提供人与 Agent 共用的完整调试能力，覆盖断点、单步、调用栈、变量、求值、异常、线程、重启/终止，以及 IDE 式工作台。
- 参考实现：LSP 能力缝（`packages/lsp/lsp/src/index.ts`）、后台任务所有权与唤醒模型（`packages/jobs/jobs/README.md`）、工作区文件读取（`packages/api/workspace-files/README.md`）、客户端停靠布局（`packages/client/ui-dockkit/README.md`）。

## 1. 背景与目标

### 1.1 背景

Harness 当前没有调试器。`packages/experimental/inspector` 使用 CDP 调试 Harness 自身，不是用户程序调试；Web 客户端有文件树、文档预览、终端和 diff 卡片，但没有代码编辑器，也没有 DAP（Debug Adapter Protocol）集成。

LSP 已经证明「Service Definition / Service Provider / Consumer」三段式能力缝适合语言工具：provider 只负责语言差异，消费者共用同一套归一化操作。`ctx.lsp` 至今只有模型工具一个消费者，本设计是第一个 UI 消费者，所以三段式是已验证的形状、UI 消费是新增路径。调试能力采用同一结构，但额外需要长生命周期会话、异步停住事件和双向控制。

### 1.2 目标

1. 人与 Agent 共用同一个调试会话：人在工作台操作，Agent 通过工具操作，双方看到同一份状态。
2. 首批内置 Node.js/TypeScript、Python、Go、Rust/C/C++ 四种 provider。
3. 本机、SSH、沙箱三种执行世界使用同一套调试能力；执行世界跟随现有 `ctx.fs` / `ctx.subprocess` provider。
4. 提供完整工作台：文件树、多标签编辑器、断点槽、当前行高亮、调用栈、变量、监视、调试控制台、线程、断点列表、反汇编/内存等适配器支持的面板。
5. 提供模型工具：启动/附加、断点、继续/暂停/单步、调用栈、变量、求值、异常、重启/终止。
6. 适配器托管安装、固定版本、校验和验证，并允许用户覆盖命令与路径。
7. Web、Desktop、CLI 三端都具备调试能力，共享同一调试核心，交互重心按平台区分。
8. 遵守 Harness 的会话、权限、沙箱和文档约束；不改变 agent loop。

### 1.3 非目标

- 不暴露原始 DAP 请求/响应逃生口。公共契约只提供归一化操作，避免协议泄漏和绕过权限。
- 不实现跨 Harness 进程重启的调试会话恢复。调试会话是进程内资源，Host 重启后会话结束。
- 不把变量值、内存内容或完整 DAP 流量写入 Session 日志。
- 不提供移动端完整 IDE。窄屏使用折叠面板和只读降级，不承诺手机级工作台。
- CLI 不内嵌完整代码编辑器；使用只读源码预览和 `$EDITOR`/远程编辑器。
- 不在 v1 集成 LSP 的补全、诊断、重构；编辑器的语言能力仅用于语法高亮和调试断点。
- 不做多用户实时协作、光标共享或调试控制权抢占。同一工作区的多个客户端可以观察和控制同一会话，但不做 presence。

### 1.4 成功标准

- 人能在一个工作台里对四种语言完成「启动 → 断点命中 → 单步 → 查看变量 → 求值 → 继续 → 终止」闭环。
- Agent 能通过工具完成同一闭环，并在非自己发起的停住发生时收到唤醒通知。
- CLI 用户能在 TUI 中完成同一闭环；`headless --json` 输出 NDJSON 调试事件供脚本和 CI 消费。
- 同一会话可以被人和 Agent 交替控制，状态不漂移。
- 本机、SSH、沙箱三种执行世界都能启动并命中至少一个断点；无法支持的组合必须明确报错，不静默降级。
- 断点在 Host 重启后保留；调试会话不保留，并在 UI 和工具结果中明确显示已结束。
- 所有模型可见的调试事实都能从 Session 日志重建；所有用户可见文本走 i18n 字典。

## 2. 已确认的产品决策

| 决策 | 结果 |
|---|---|
| 主要使用者 | 人和 Agent 共用 |
| 首批语言 | Node.js/TypeScript、Python、Go、Rust/C/C++ |
| 执行环境 | 本机、SSH、沙箱全部支持 |
| 前端范围 | 完整工作台：文件树、多标签编辑器、终端、调试面板 |
| 适配器获取 | 托管安装固定版本 + 用户可覆盖 |
| 功能覆盖 | 核心功能 + 适配器支持的全部特性 |
| 共享权限 | Agent 可见同工作区全部会话；控制自有会话默认可用，控制他人创建的会话需按会话授权（第 8.5 节） |
| 组合归属 | 已裁决（2026-10-25）：官方可选 bundle `OPTIONAL_BUNDLES` 路线，v1 不进 `dsh-base`（第 3.3 节、第 21 节） |
| 客户端覆盖 | Web/Desktop 完整工作台；CLI 轻量会话 + 交互式 TUI + 命令模式 + headless NDJSON |
| 交付策略 | 一次性全量功能，内部按可独立验收的里程碑推进 |

三端共享 `ctx.debug`、模型工具、断点存储、适配器管理和 Session 事件；差异只在渲染、输入、执行世界可见性和自动化能力。

「适配器支持的全部特性」指通过能力协商暴露 DAP 功能面，包括条件断点、命中次数、日志点、函数断点、数据断点、指令断点、异常过滤器、单步回退、重启帧、设置变量/表达式、补全、模块、已加载源、反汇编、内存读写、终止/重启、延迟栈、格式化选项、ANSI、进度、反向请求等。两个例外：原始 DAP 透传永不提供；内存写入默认关闭，逐次审批后才允许。

Agent 的可见范围是整个工作区：可以 `list`/`get` 该工作区内所有会话。控制范围按会话授予：自有会话默认可控制，他人创建的会话需要人在工作台打开该会话的控制开关或对该次调用单独审批（第 8.5 节）。Agent 创建或附加新会话仍经过审批；跨工作区会话不可见、不可控制。

## 3. 总体架构

```text
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ Web/Desktop Workbench        │      │ Agent Tools                  │
│ ui-code-editor / ui-debug    │      │ debug_session / debug_*      │
└──────────────┬───────────────┘      └──────────────┬───────────────┘
               │ Remote (Typert unary + stream)      │ same-process service
               ▼                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ ctx.debug — DebugService                                             │
│  provider registry · session registry · ownership · events           │
│  normalized model · capability negotiation · bounds                  │
└──────────────┬───────────────────────────────────────────────────────┘
               │ DebugSession
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ dsh-debug-dap — DAP client                                           │
│  framing · request/response · events · reverse requests · timeouts   │
└──────────────┬───────────────────────────────────────────────────────┘
               │ stdio or tunneled stream
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Debug adapter process                                                │
│  js-debug / debugpy / dlv dap / lldb-dap                             │
└──────────────┬───────────────────────────────────────────────────────┘
               │ DAP launch/attach
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Target program in the Session execution world                        │
│  local · SSH · sandbox                                               │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 为什么选择 DAP

DAP 是四种语言适配器共同实现的协议，能把「多语言」收敛为 provider 选择与 launch 配置差异。它同时被 VS Code、lldb-dap、dlv、debugpy 和 js-debug 验证，覆盖本设计与「全部适配器特性」的目标。同一个 DAP seam 同时服务浏览器、桌面和终端；三端只负责渲染、输入和平台集成。

不采用外部 IDE 托管，因为核心要求是 Harness 内的人机共用工作台。不采用各语言原生协议直连，因为会产生四套协议、四套状态机和不可扩展的新增语言成本。

### 3.2 包结构

| 包 | 分组 | 职责 |
|---|---|---|
| `debug/debug` | `packages/debug` | Service Definition：`ctx.debug`、类型、provider 注册、会话注册表、所有权、事件、投影 |
| `debug/debug-dap` | `packages/debug` | 通用 DAP 客户端与传输层，不包含语言知识 |
| `debug/debug-adapter-manager` | `packages/debug` | 适配器清单、平台探测、托管安装、校验、覆盖配置 |
| `debug/debug-node` | `packages/debug` | Node.js/TypeScript provider |
| `debug/debug-python` | `packages/debug` | Python provider |
| `debug/debug-go` | `packages/debug` | Go provider |
| `debug/debug-native` | `packages/debug` | Rust/C/C++ provider |
| `debug/tool-debug` | `packages/debug` | 四个模型工具、提示词、停住通知 |
| `api/debug-controller` | `packages/api` | Web/Desktop 的 Remote 方法与事件流，含编辑器保存所需的 `ctx.fs` 版本守卫写 |
| `client/ui-code-editor` | `packages/client` | CodeMirror 6 编辑器、标签、断点槽、当前行、查找替换 |
| `client/ui-debug` | `packages/client` | 调试工具条、调用栈、变量、监视、断点、控制台、适配器设置 |
| `client/ui-workbench` | `packages/client` | 工作台布局、面板注册、文件树/终端复用、快捷键 |
| `bundle/debug` | `packages/bundle` | Web/Desktop 的组合层；headless/SDK/ACP 只加载模型侧 |
| `tui/tui-debug` | `packages/tui` | 终端调试面板、命令解析、源码预览；直接消费 `ctx.debug` |
| `bundle/tui-app` | `packages/bundle` | 发布 `tui` profile 的组合层 |

`apps/tui` 提供终端应用入口、渲染循环和输入处理；`packages/tui/tui-debug` 提供可复用的调试面板、命令和源码预览。`apps/tui` 不是独立可执行 bin，仍由 `dsh tui` 启动。

`packages/debug` 是非实验性产品分组，因为调试有明确产品角色和消费者。若后续功能收缩，应整体迁移，而不是把单个包留在实验分组。

### 3.3 组合方式

- 模型侧组合（`debug`、`debug-dap`、`debug-adapter-manager`、四个 provider、`tool-debug`）与 UI 侧组合都由官方可选 bundle `@deepseek-ai/dsh-debug-bundle` 提供，登记 `OPTIONAL_BUNDLES`，默认关闭，由 plugin manager 开启。headless、SDK、ACP 部署显式启用后获得 Agent 调试；这些组合必须由部署提供审批回答者，否则 launch/attach 按现有 fail-closed 规则拒绝。适配器二进制不会随包安装，首次使用时才提示安装。
- `dsh-web-app` / 桌面端额外加载 `api/debug-controller`、`ui-code-editor`、`ui-debug` 和 `ui-workbench`；编辑器保存复用 `ctx.fs`，不引入新的写入包。
- `bundle/debug`（包名 `@deepseek-ai/dsh-debug-bundle`）是官方可选组合层，登记 `OPTIONAL_BUNDLES`，按其语义不被任何 shipped template 选中、默认关闭；headless/SDK/ACP 启用时只加载模型侧。「Web/Desktop 默认启用」是 M5 验收后的独立后续决策（把 bundle 移入 web 模板），不随 v1 交付。
- `bundle/tui-app` 发布 `tui` profile：加载 `dsh-base`、`apps/tui` 和 `tui-debug`，不加载浏览器传输层；`dsh tui` 启动终端会话与调试工作台，同一进程内直接消费 `ctx.debug`。
- `dsh headless --json` 在不绕过工具权限的前提下，把 `debug/*` 生命周期和停住事件作为 NDJSON 输出给脚本与 CI；不输出原始 DAP、变量值或内存内容。
- 所有注册通过 `ctx.effect()` / `ctx.on()`，disposer 释放；可选服务用 `ctx.get('debug')`，不直接读属性代理。
- 组合归属已裁决（2026-10-25，第 21 节）：走可选 bundle 路线，加入 `OPTIONAL_BUNDLES`（`packages/util/official-bundles/src/bundles.ts`），由 plugin manager 提供开关、带 `icon` 与 `./locale/*.json` 显示元数据。依据是仓库把新能力先做成可选 bundle 的既有准入决定，以及不为每个部署强加审批回答者缺位的 fail-closed 成本；本节上文「`dsh-base` 加载」的表述已被裁决替换。

### 3.4 三端体验矩阵

三端共享同一个调试核心，但突出点不同：

| 维度 | Web | Desktop | CLI / TUI |
|---|---|---|---|
| 核心与工具 | 同一 `ctx.debug`、同一模型工具、同一断点存储 | 同 Web | 同 Web，直接注入本地服务 |
| 主界面 | 浏览器完整工作台 | Electron 完整工作台 | 终端全屏面板 + 命令模式 + 轻量会话 |
| 会话输入 | 对话面板 | 对话面板 | 纯文本会话记录 + 输入行 |
| 源码 | CodeMirror 多标签编辑 | 同 Web | 只读预览 + `$EDITOR`/远程编辑器跳转 |
| 启动/附加 | 服务器执行世界，PID/端口/URL | 本地与远程执行世界，provider 声明的原生进程选择器 | 本机/SSH，命令或 `:attach` |
| 适配器 | Host/执行世界托管安装 | 本地托管安装、离线缓存、系统级权限检查 | 本地/远端安装或预装路径 |
| 通知 | 应用内通知 | OS 通知 + 应用内通知 | 终端状态栏/响铃，可关闭 |
| 协作 | 同一工作区多客户端共享会话 | 同一 Host 多窗口共享会话 | 同一 TUI 内人与 Agent 共用 |
| 自动化 | 有限，主要面向 UI | 有限，主要面向 UI | 主要场景：NDJSON、命令、CI |
| 离线 | 取决于 Host 部署 | 是，本地 Host | 是，本地或持久 SSH |
| 适合 | 远程工作区、团队、跨设备 | 本地深度调试、系统集成 | SSH、CI、键盘流、低带宽 |

三端的归一化状态、能力协商、错误码和 Session 事件必须一致；平台差异只允许出现在呈现、输入方式、适配器来源和通知通道。

### 3.5 平台集成契约

- Web 只使用浏览器 API；原生动作通过 Host 的 Remote 完成。浏览器不直接列进程、发 OS 通知或下载适配器；attach 只接受 PID/端口/URL，通知使用应用内通知，适配器安装在 Host 或所选执行世界。
- Desktop 使用 Electron 主进程/渲染进程能力提供 OS 通知、应用菜单、快捷键、多窗口、深链接和外部编辑器打开；原生进程选择器只展示 provider 通过执行世界发现的进程，Electron 不实现独立调试器；适配器可缓存到本地以支持离线，启动前检查 ptrace/task_for_pid 等系统权限。
- CLI/TUI 只依赖终端和标准输入输出；通知使用状态栏和响铃，外部编辑器通过 `$EDITOR` 或显式配置的远程编辑器命令，适配器在本地或远端执行世界安装/预装。
- 三端都通过 `ctx.debug` 执行调试，不在客户端实现 DAP、provider 选择或 launch 参数解析。平台集成可以改变入口和呈现，不能改变调试语义、审批或工作区边界。

### 3.6 会话共享与所有权

- Web 多标签页、多浏览器和 Desktop 多窗口连接同一个 Host 时，共享同一批调试会话和断点；`remote-access` 决定可见性。
- TUI 和 `headless` 各自运行自己的 Host 进程，调试会话不跨 Host 共享；v1 不提供 TUI 连接已在运行的 Web/Desktop Host。
- 同一工作区内，Agent 可以列出和控制所有会话；人可以接管 Agent 启动的会话，Agent 也可以接管人启动的会话。所有控制写入 `debug/control` 审计。
- Host 重启后会话消失，所有客户端显示已结束；断点和命名配置从存储恢复。

## 4. 能力缝契约

### 4.1 标识与值类型

- `DebugProviderId`、`DebugSessionId`、`DebugCompoundId`、`DebugThreadId`、`DebugFrameId`、`DebugVariableReference`、`DebugBreakpointId`、`DebugSourceReference` 使用 `Branded<...>`，不使用裸 `string`。
- DAP 把 `threadId`、`frameId`、`variablesReference`、`breakpoint.id`、`sourceReference` 定义为 number。seam 的转换规则唯一：入站 `number → Brand<...>` 在 `debug-dap` 后端完成，出站 `Brand<...> → number` 也只在这里；`packages/debug/debug` 的公共类型不含 number id。耐久事件里的 id 是 `string`（品牌化值的序列化形式），重放不得当作可继续使用的句柄。
- `DebugSource` 同时携带 `workspaceRelativePath`（模型与工具用）、`absolutePath`（执行世界路径）和可选 `sourceReference`；UI 需要 `dsh-resource://file/session/<id>/<path>` 时由 `api/debug-controller` 从 `workspaceRelativePath` 构造，seam 本身不出现 resource address，也不出现单一裸 `string` 表示路径。
- `DebugSessionId` 形如 `debug-<16位小写uuidhex>`，与 job id 风格一致；id 可预测，授权依靠工作区边界和所有权，不依靠保密。
- 行号从 1 开始，列号从 1 开始。DAP `initialize` 显式发送 `linesStartAt1: true`、`columnsStartAt1: true`、`pathFormat: 'path'`，避免模型、编辑器和协议之间的坐标转换。
- 时间字段使用毫秒；超时字段使用毫秒；所有上限都有配置字段，不写死部署相关常量。

### 4.2 会话状态

```text
starting ──► running ──► stopped ──► running
   │            │            │
   │            ├────────────┴──► terminated
   ├────────────┴───────────────► failed
   └────────────────────────────► terminated
```

| 状态 | 含义 | 允许操作 |
|---|---|---|
| `starting` | 适配器已启动，正在 initialize/配置/launch | `terminate`、`disconnect` |
| `running` | 目标程序在运行 | `pause`、`restart`、`terminate`、`disconnect`；拒绝 `continue`、`step*`、`inspect*`、`evaluate`、`set*` |
| `stopped` | 目标程序停住 | `continue`、`step*`、`restart`、`restartFrame`、`inspect*`、`evaluate`、`set*`、`terminate`、`disconnect` |
| `terminated` | 目标进程退出、`terminate` 或 `disconnect` | 只读快照；`terminate` 与 `disconnect` 幂等返回当前状态；其余控制返回 `DEBUG_INVALID_STATE` |
| `failed` | 适配器崩溃、launch 失败、协议错误 | 只读快照和错误详情；`terminate` 与 `disconnect` 幂等返回当前状态；其余控制返回 `DEBUG_INVALID_STATE` |

状态事件集合固定为 `launch-succeeded`、`stopped`、`continued`、`restart`、`terminated`、`disconnected`、`failed` 七个；适配器进程启动即进入 `starting`，不设 `adapter-ready` 事件。每个事件的源状态与目标状态都在转移表里穷举，未列出的组合抛 `DEBUG_INVALID_STATE`。`terminated` 与 `disconnected` 是两个不同终态来源，`debug/session-ended` 的 `outcome` 取 `terminated | disconnected | failed`（第 8.6 节）。

`terminating` 是内部子状态，不对外暴露；`restart` 从 `stopped` 或 `running` 回到 `starting`，并产生新的 DAP 进程或适配器 restart 请求。

### 4.3 服务 API

```text
interface DebugService {
  registerProvider(provider: DebugProvider): () => void
  launch(request: DebugLaunchRequest, options?: DebugOperationOptions): Promise<DebugSession>
  attach(request: DebugAttachRequest, options?: DebugOperationOptions): Promise<DebugSession>
  launchCompound(request: DebugCompoundRequest, options?: DebugOperationOptions): Promise<DebugCompound>
  list(scope?: DebugScope): readonly DebugSessionInfo[]
  get(id: DebugSessionId): DebugSession | undefined
  listCompounds(scope?: DebugScope): readonly DebugCompoundInfo[]
  getCompound(id: DebugCompoundId): DebugCompound | undefined
  setBreakpoints(request: DebugBreakpointSetRequest): Promise<DebugBreakpointResult>
  events: DebugEventSource
}
```

`DebugOperationOptions` 只包含可选的 `signal` 和调用者身份（`{ kind: 'agent' \| 'user', sessionId }`），不包含传输、UI 或 provider 私有字段。每个 `launch`/`attach` 都必须带发起 Session：Agent 用被调用的 Session，人用工作台当前对话 Session。会话终态清理和归档 admission 都以 Session 为键（第 7.5 节），无 Session 归属的会话无人报告、只能等 Host 关闭才清理，因此 seam 直接拒绝。

`launch` 与 `attach` 都返回单个 `DebugSession`；复合配置只经 `launchCompound` 返回 `DebugCompound`。`DebugCompound` 持有 `id`、会话列表、`stopAll` 和聚合状态，提供 `terminate()`、`restart()` 和 `events`；复合配置中的会话仍可通过 `ctx.debug.get` 单独访问。

`DebugService.setBreakpoints` 写入工作区持久化断点，并把结果应用到所有匹配的活动会话；`DebugSession.setBreakpoints` 只对当前会话应用，不改变持久化记录。模型工具默认使用服务级操作，因此人和 Agent 看到同一份断点集合。

`launch`/`attach` 的请求字段：

| 字段 | 说明 |
|---|---|
| `providerId` | 语言 provider，显式必填或由命名配置解析 |
| `request` | `launch` 或 `attach` |
| `workspaceRoot` | 会话工作区根，必填，不默认 |
| `cwd` | 目标进程工作目录，必填或由配置解析 |
| `program` / `module` / `args` | provider 解释的程序入口与参数 |
| `env` | 环境变量；日志和通知中脱敏 |
| `stopOnEntry` | 是否在入口停住 |
| `configurationName` | 命名配置引用；与内联字段互斥 |
| `breakpoints` | 启动前要应用的断点；缺省时使用工作区持久化断点 |
| `compoundName` | 复合配置名；仅 `launchCompound` 使用 |
| `caller` | `{ kind: 'agent' \| 'user', sessionId }`，用于所有权、审计和清理归属；两个 kind 都必带 Session |

`DebugScope` 包含 `workspaceId` 和可选 `ownerSessionId`。服务拒绝跨工作区请求，即使调用者是 Agent。

### 4.4 DebugSession API

```text
interface DebugSession {
  readonly id: DebugSessionId
  readonly providerId: DebugProviderId
  readonly state: DebugSessionState
  readonly capabilities: DebugCapabilities
  readonly stop?: DebugStopSnapshot
  readonly info: DebugSessionInfo

  setBreakpoints(request: DebugBreakpointSetRequest): Promise<DebugBreakpointResult>
  setExceptionBreakpoints(request: DebugExceptionBreakpointRequest): Promise<DebugBreakpointResult>
  setFunctionBreakpoints(request: DebugFunctionBreakpointRequest): Promise<DebugBreakpointResult>
  setDataBreakpoints(request: DebugDataBreakpointRequest): Promise<DebugBreakpointResult>
  setInstructionBreakpoints(request: DebugInstructionBreakpointRequest): Promise<DebugBreakpointResult>

  continue(threadId?: DebugThreadId, options?: DebugOperationOptions): Promise<DebugResumeResult>
  pause(threadId?: DebugThreadId, options?: DebugOperationOptions): Promise<void>
  step(kind: DebugStepKind, threadId?: DebugThreadId, granularity?: DebugSteppingGranularity): Promise<DebugResumeResult>
  restartFrame(frameId: DebugFrameId): Promise<void>
  restart(): Promise<void>
  terminate(): Promise<void>
  disconnect(): Promise<void>

  threads(): Promise<readonly DebugThread[]>
  stackTrace(threadId: DebugThreadId, options?: DebugStackTraceOptions): Promise<DebugStackTrace>
  scopes(frameId: DebugFrameId): Promise<readonly DebugScopeInfo[]>
  variables(reference: DebugVariableReference, options?: DebugVariablesOptions): Promise<DebugVariablesPage>
  evaluate(expression: string, context: DebugEvaluateContext, frameId?: DebugFrameId): Promise<DebugEvaluateResult>
  setVariable(reference: DebugVariableReference, name: string, value: string): Promise<DebugVariable>
  setExpression(expression: string, value: string, frameId?: DebugFrameId): Promise<DebugEvaluateResult>
  completions(text: string, column: number, frameId?: DebugFrameId): Promise<readonly DebugCompletion[]>
  exceptionInfo(threadId: DebugThreadId): Promise<DebugExceptionInfo>
  modules(options?: DebugModulesOptions): Promise<DebugModulesPage>
  loadedSources(): Promise<readonly DebugSource[]>
  source(sourceReference: DebugSourceReference): Promise<DebugSourceContent>
  disassemble(request: DebugDisassembleRequest): Promise<DebugDisassembly>
  readMemory(request: DebugReadMemoryRequest): Promise<Uint8Array>
  writeMemory(request: DebugWriteMemoryRequest): Promise<void>
  console(options?: DebugConsoleOptions): Promise<DebugConsolePage>
  attachTargets?(): Promise<readonly DebugAttachTarget[]>
}
```

所有返回集合都有 `truncated` / `total` 或分页字段；`console` 使用非消费偏移游标，模型读取时推进自己的游标。`variables` 只返回一层，子节点通过新的 `variablesReference` 展开，绝不递归展开整棵树。

断点结果不复用请求输入。每个断点用归一化 `DebugBreakpoint` 表达：`{ id: DebugBreakpointId, source: DebugSource, requestedLine, actualLine?, verified, message? }`，`DebugBreakpointResult` 是 `{ applied: readonly DebugBreakpoint[]; rejected: readonly DebugBreakpoint[] }`。适配器分配的 `id` 和实际落点 `actualLine` 是第 9.3 节空心/实心图标与拖动改行的前提，缺任一项这两个 UI 行为就无法实现。

`DebugResumeResult` 是封闭 union：`{ kind: 'stopped', stop }`、`{ kind: 'terminated' }`、`{ kind: 'running' }`。`continue` 和 `step` 默认等待下一次停住或 `launchTimeoutMs`/`requestTimeoutMs` 内超时；超时返回 `running`，不取消目标程序。若调用者的 `signal` 中止，工具调用返回取消，但会话继续运行，后续停住通过通知送达。

### 4.5 Provider API

```text
interface DebugProvider {
  readonly id: DebugProviderId
  readonly extensions: readonly string[]
  readonly displayName: string
  readonly adapter: DebugAdapterDescriptor
  readonly configSchema: JsonSchema
  resolveLaunch(request: DebugLaunchRequest, environment: DebugEnvironment): Promise<DebugLaunchPlan>
  resolveAttach(request: DebugAttachRequest, environment: DebugEnvironment): Promise<DebugAttachPlan>
  probeAttachTargets?(environment: DebugEnvironment, signal?: AbortSignal): Promise<readonly DebugAttachTarget[]>
}
```

`resolveLaunch` / `resolveAttach` 是显式的 `resolve(request): Spec` 步骤，所有默认值、路径展开、变量替换、适配器选择都在这里完成；`run()` 不隐藏 `?? default`。`DebugLaunchPlan` 包含：

- 适配器命令、参数、环境、工作目录。
- DAP launch/attach 参数。
- 目标进程命令、参数、环境、工作目录。
- 所需执行世界能力：`ptrace`、`processControl`、`networkListen`、`python`、`go`。
- 适配器清单版本与校验信息。
- 启动失败时的可操作说明。

`DebugAttachPlan` 与 launch 计划对称：适配器命令、DAP attach 参数、可选隧道端点（host/port）、所需能力、清单版本与失败提示；附加目标由 `DebugAttachTarget` 显式描述（名称与 PID/端口/URL 之一）。适配器命令统一为 `DebugAdapterCommand`（command、args、env、cwd），launch 与 attach 计划共用。

Provider 不直接 `spawn` 或读文件，必须通过 `DebugEnvironment`：`subprocess`、`fs`、`cwd`、`platform`、`pathSeparator`、`shell`。这保证本机、SSH、沙箱共用同一 provider。

### 4.6 错误模型

`DebugError extends HarnessError`，稳定错误码至少包括：

| 错误码 | 场景 |
|---|---|
| `DEBUG_INVALID_PROVIDER` | provider id 为空、扩展非法、provider 注册参数不合法 |
| `DEBUG_CONFLICT` | 重复 provider id 或扩展 |
| `DEBUG_UNAVAILABLE` | 服务未组合、provider 未注册 |
| `DEBUG_ADAPTER_NOT_FOUND` | 适配器未安装、路径不存在、版本不匹配 |
| `DEBUG_ADAPTER_UNSUPPORTED` | 当前平台/执行世界不支持该适配器 |
| `DEBUG_ADAPTER_CHECKSUM` | 下载文件校验和不匹配 |
| `DEBUG_LAUNCH_FAILED` | launch/attach 请求失败 |
| `DEBUG_NOT_STOPPED` | 运行中读取栈、变量、求值 |
| `DEBUG_INVALID_STATE` | 在终止状态继续、重复启动、错误状态转换 |
| `DEBUG_STALE_REFERENCE` | 继续后使用旧 frame/variable reference |
| `DEBUG_UNSUPPORTED_CAPABILITY` | 适配器未声明该能力 |
| `DEBUG_TIMEOUT` | initialize/launch/request 超时 |
| `DEBUG_MALFORMED_RESPONSE` | DAP 帧非法、字段缺失、消息超限 |
| `DEBUG_SANDBOX_DENIED` | 沙箱策略拒绝 ptrace/process-control |
| `DEBUG_ATTACH_UNSUPPORTED` | 执行世界无法建立附加传输 |
| `DEBUG_SESSION_GONE` | Host 重启或会话已被清理 |
| `DEBUG_WORKSPACE_MISMATCH` | 跨工作区访问 |
| `DEBUG_APPROVAL_DENIED` | 启动/附加/内存写入审批失败 |
| `DEBUG_CONTROL_NOT_GRANTED` | 调用方没有该会话的控制授权（第 8.5 节） |
| `DEBUG_INVALID_CONFIG` | 命名配置 schema 非法、重名、未解析变量、复合配置引用缺失 |
| `DEBUG_BREAKPOINT_LIMIT` | 单文件或全局断点数超过配置上限 |
| `DEBUG_UNKNOWN_OPERATION` | 工具或 TUI 命令收到未声明的操作 |

`debug/event-cursor-expired` 不属于本 seam 的错误码：它是 Remote 层的流控制码，归 `api/debug-controller`。

所有错误都包含 `providerId`、`sessionId`（适用时）、`workspaceId` 和可操作的 `detail`；调用者按 `code` 分支，不解析 `message`。

### 4.7 事件与订阅

`ctx.debug.events` 提供按会话、按工作区、进程级订阅：

- `session/starting`、`session/running`、`session/stopped`、`session/terminated`、`session/failed`
- `breakpoint/changed`（适配器验证结果变化）
- `console/output`（有界环）
- `adapter/output`（适配器 stderr，有界）
- `session/owner-changed`（人工接管/Agent 接管，仅审计）
- `capabilities/changed`（适配器动态能力通知）

`debug.events` 中的 `session/*` 是 live 事件，不进入 Session 日志；耐久事实使用第 8.6 节的 `debug/*` 事件。

订阅是 effect，disposer 必须释放；事件只在状态提交后发布，不在请求发出时发布。未知 DAP 事件被忽略并写入调试 trace，不使会话失败；`output`、`exited`、`terminated` 等关键事件必须映射。

### 4.8 并发、取消与清理

- 每个会话一个串行请求队列；DAP 协议允许并发请求，但本实现按会话串行化，避免状态竞争和调试器差异。
- 两个例外，否则会自锁：`continue`/`step` 等待下一次停住期间不占用队列头（等待登记为可被停住事件提前结算的等待者，队列继续放行后续请求）；适配器发起的反向请求（`runInTerminal`、`startDebugging`）在队列之外处理，因为它由适配器驱动、正等待队列里的 `launch` 完成。
- 每个请求有超时；`initialize`、`launch`、`attach`、`terminate` 使用独立可配置超时。
- 取消会发送 DAP `cancel`（适配器支持时），并立即释放等待者；不自动终止目标程序。
- `terminate` 先请求适配器终止，再在有界时间内等待进程树退出；超时后升级为强制终止，并记录原因。
- owner 释放、工作区归档、Host 关闭都触发会话清理；清理等待适配器退出，避免孤儿进程。
- 会话清理完成后发布 `terminated`，再释放 id；重复清理幂等。

### 4.9 适配器管理服务

`ctx.debugAdapters`（`DebugAdapterManager`）拥有清单、平台探测、安装、卸载和解析。它不发起审批；调用方必须已经完成用户确认。所有安装、探测和自检都在目标执行世界执行。

```text
interface DebugAdapterManager {
  list(environment?: DebugEnvironment): Promise<readonly DebugAdapterStatus[]>
  probe(providerId: DebugProviderId, environment: DebugEnvironment): Promise<DebugAdapterStatus>
  install(providerId: DebugProviderId, environment: DebugEnvironment, options?: DebugAdapterInstallOptions): Promise<DebugAdapterInstallResult>
  uninstall(providerId: DebugProviderId, environment: DebugEnvironment): Promise<void>
  resolve(providerId: DebugProviderId, environment: DebugEnvironment): Promise<ResolvedDebugAdapter>
  events: DebugAdapterEventSource
}
```

`resolve` 返回 `{ command, args, env, version, platform, source, executablePath }`；缺失、平台不支持或校验失败分别返回 `DEBUG_ADAPTER_NOT_FOUND`、`DEBUG_ADAPTER_UNSUPPORTED`、`DEBUG_ADAPTER_CHECKSUM`。`install` 幂等；同一 provider/platform 的并发安装共享一个操作；失败不留下半安装目录。`probe` 返回安装状态、版本、路径和自检结果。可选服务通过 `ctx.get('debugAdapters')` 读取。

## 5. DAP 客户端

### 5.1 握手顺序

1. 通过执行世界启动适配器进程，捕获 stdout/stdin/stderr。
2. 发送 `initialize`，声明 `clientID`、`linesStartAt1: true`、`columnsStartAt1: true`、`pathFormat: 'path'`、`supportsRunInTerminalRequest`、`supportsStartDebuggingRequest`、能力标志。
3. 等待 `initialized` 事件；部分适配器在 attach 时顺序不同，按 provider 声明的兼容模式处理。
4. 依次发送 `setBreakpoints`、`setFunctionBreakpoints`、`setExceptionBreakpoints`、`setDataBreakpoints`、`setInstructionBreakpoints`，只发送适配器支持的类型。
5. 若 `supportsConfigurationDoneRequest`，发送 `configurationDone`。
6. 发送 `launch` 或 `attach`，等待 `stopped` / `terminated` / 错误响应。
7. 进入运行状态，开始处理事件和反向请求。

### 5.2 反向请求

- `runInTerminal`：通过 `ctx.terminals` 或 `ctx.subprocess` 在目标执行世界创建终端，返回进程 id；无终端服务时返回失败响应，不让适配器挂起。
- `startDebugging`：创建子会话，父子会话共享工作区和所有者；父会话终止时按 `stopAll` 配置决定是否终止子会话。
- `handshake`：按适配器要求回应；未知反向请求返回 `unsupported`，记录 trace。
- 所有反向请求都经过权限检查：启动子会话仍按新会话审批，终端创建按现有终端权限。

### 5.3 传输

```text
interface DebugTransport {
  readonly input: AsyncIterable<Uint8Array>
  write(bytes: Uint8Array): Promise<void>
  end(): Promise<void>
}
```

- `stdio`：默认，适用于 launch 和大多数 attach；适配器由 `ctx.subprocess` 启动，stdin/stdout 连接。
- `tunnel`：用于 SSH attach 或需要 TCP 的适配器；由 SSH provider 建立本地监听并转发到远端端口，DAP 客户端连接本地端口。无法建立隧道时返回 `DEBUG_ATTACH_UNSUPPORTED`，不使用宿主机回退。
- 本地 attach 的 WebSocket/TCP 由适配器自身处理；DAP 客户端只看到 stdio 或 tunnel 流。

### 5.4 帧与限制

- `Content-Length` 分帧，UTF-8 JSON；拒绝负数、缺失头、超限消息。
- 单条消息上限 `maxMessageBytes`；超限映射 `DEBUG_MALFORMED_RESPONSE`，终止会话。
- 请求序号单调递增；响应必须匹配未完成请求；重复/未知序号按协议错误处理。
- 适配器 stderr 进入有界环，保留末尾 `adapterStderrBytes`，用于诊断；不进入模型上下文，除非工具读取 console/adapter 输出。
- 调试 trace 默认关闭；开启时写入 Host 日志，脱敏环境变量和凭据；不写 Session 日志。

### 5.5 能力协商

`DebugCapabilities` 是适配器 `initialize` 响应的归一化投影，包含布尔能力和枚举能力。UI 和工具都只通过能力位判断是否显示/允许操作；未声明时返回 `DEBUG_UNSUPPORTED_CAPABILITY`。新增能力不改变已有操作语义；未知能力字段忽略并保留在 trace。

能力到功能的映射示例：

| 能力 | 功能 |
|---|---|
| `supportsConditionalBreakpoints` | 条件断点 |
| `supportsHitConditionalBreakpoints` | 命中次数断点 |
| `supportsLogPoints` | 日志点 |
| `supportsFunctionBreakpoints` | 函数断点 |
| `supportsDataBreakpoints` | 数据断点 |
| `supportsInstructionBreakpoints` | 指令断点 |
| `supportsExceptionFilterOptions` | 异常过滤器 |
| `supportsStepBack` | 单步回退 |
| `supportsRestartFrame` | 重启帧 |
| `supportsSetVariable` / `supportsSetExpression` | 修改变量/表达式 |
| `supportsCompletionsRequest` | 控制台补全 |
| `supportsModulesRequest` | 模块面板 |
| `supportsLoadedSourcesRequest` | 已加载源面板 |
| `supportsDisassembleRequest` | 反汇编面板 |
| `supportsReadMemoryRequest` | 内存读取 |
| `supportsWriteMemoryRequest` | 内存写入（默认关闭，逐次审批） |
| `supportsTerminateRequest` / `supportsRestartRequest` | 终止/重启 |
| `supportsDelayedStackTraceLoading` | 分页栈 |
| `supportsValueFormattingOptions` | 变量格式化 |
| `supportsANSIStyling` | 控制台 ANSI |
| `supportsProgressReporting` | 进度条 |
| `supportsRunInTerminalRequest` | 外部终端 |
| `supportsStartDebuggingRequest` | 子会话/复合配置 |

## 6. 语言 provider 与适配器管理

### 6.1 Provider 清单

| Provider | 适配器 | 许可证 | 安装来源 | 备注 |
|---|---|---|---|---|
| `node` | js-debug DAP server | MIT | GitHub release 归档（`js-debug-dap-<version>.tar.gz`），托管安装 | 支持 launch/attach、子进程、source map；attach 可用 PID/端口/URL；SHA-256 采用 GitHub 资产官方 digest |
| `python` | debugpy | MIT | PyPI wheel，托管安装到隔离环境 | 需要用户选择目标解释器；支持 launch/attach、子进程、justMyCode |
| `go` | Delve `dlv dap` | MIT | GitHub release 固定二进制 | 需要匹配 Go 工具链；支持 launch/attach、goroutine |
| `native` | `lldb-dap` | Apache-2.0 WITH LLVM-exception | LLVM release，或使用系统/Xcode 已有版本 | 支持 Rust/C/C++；attach 依赖 ptrace/task_for_pid 权限 |

适配器版本固定在仓库内清单中，不使用 `latest`。每个平台组合单独记录 URL、归档格式、可执行文件路径、SHA-256、许可证文本和所需系统依赖。实现时先验证上游发布物和许可证，再写入清单；清单变更走正常 PR 评审。

### 6.2 适配器清单

```text
interface DebugAdapterManifest {
  providerId: DebugProviderId
  version: string
  license: string
  source: { kind: 'archive' | 'pypi'; url?: string; package?: string; subpath?: string }
  platforms: Record<PlatformKey, {
    archive: string
    sha256: string
    executable: string
    sizeBytes: number
    dependencies?: readonly string[]
  }>
  command: readonly string[]
  environment?: Readonly<Record<string, string>>
  requires?: readonly ('ptrace' | 'processControl' | 'networkListen' | 'python' | 'go')[]
}
```

`PlatformKey` 至少覆盖 `darwin-arm64`、`darwin-x64`、`linux-x64`、`linux-arm64`、`win32-x64`。`kind: 'archive'` 时 `platforms` 至少一条且必带 `sha256`（GitHub/LLVM release 归档，js-debug/delve/lldb-dap 均此形态）；`kind: 'pypi'` 时 `platforms` 省略，安装按目标解释器逐平台解析 PyPI 官方 digest 并校验。用户已有的系统安装（如 Xcode 自带 lldb-dap）不进清单，由第 6.4 节显式覆盖承载。未列出的平台返回 `DEBUG_ADAPTER_UNSUPPORTED`，不尝试兼容运行。

### 6.3 托管安装流程

1. 用户首次对某语言启动调试，或打开设置页点击安装。
2. Host 显示适配器名称、版本、来源、许可证、下载大小、SHA-256、安装目录。
3. 用户确认后，安装器在目标执行世界执行下载安装：`archive` 源下载/解包并校验 SHA-256；`pypi` 源用目标解释器创建隔离 venv 并 `pip install` 固定版本，逐平台 wheel 的 PyPI 官方 sha256 digest 先校验再安装。两者都写入该执行世界的 `$DSH_HOME/debug-adapters/<provider>/<version>/`（或配置的安装根；pypi 源在 `<version>/venv/`）。
4. 在该执行世界运行一次握手自检：执行 `--version` 或最小 DAP `initialize`，失败则删除安装并报 `DEBUG_ADAPTER_UNSUPPORTED`。
5. 标记已安装；后续启动直接使用。
6. 更新只在用户主动操作时进行；调试会话进行中禁止更新/卸载。

安装绝不静默执行。`allowManagedInstall` 只控制是否显示安装入口，不控制自动下载。校验和验证不可关闭。许可证文本随安装保留，设置页可查看。

### 6.4 覆盖与探测

- 用户可在 provider 配置中指定 `command`、`args`、`env`、`cwd`、`adapterPath`；显式覆盖后不再使用托管安装。
- 每个 provider 提供 `probe()`：通过执行世界的 subprocess 获取平台、架构、shell、PATH、解释器/工具链版本。探测结果缓存在会话生命周期内，不跨世界复用。
- 覆盖命令必须通过执行世界的 PATH 解析；相对路径按工作目录解析；脚本参数不经过 shell 拼接，直接作为 argv。
- 覆盖版本不匹配时，启动前警告并允许继续；托管版本不匹配直接失败，避免协议差异。

### 6.5 语言差异

- Node：`program`/`module` 二选一；支持 `runtimeExecutable`、`runtimeArgs`、`autoAttachChildProcesses`、`sourceMaps`、`outFiles`、`console`；attach 支持 `processId`、`port`、`url`。js-debug 的 DAP server 以 GitHub release 归档安装（非 npm；npm 上的同名 "js-debug" 包是无关第三方）。
- Python：`program`/`module` 二选一；`python` 解释器必填或由配置解析；`justMyCode`、`subProcess`、`django`、`flask` 作为 provider 选项；debugpy 安装在基于目标解释器的隔离 venv 中，不污染用户环境。
- Go：`program` 或 `package`；支持 `mode`（debug/test/exec/auto）、`buildFlags`、`dlvFlags`；attach 支持 `processId`/`port`；Delve 版本需与目标二进制兼容。
- Native：`program`、`args`、`cwd`、`env`、`stopOnEntry`；attach 支持 `processId`/`port`；macOS 可能需要 Xcode 命令行工具或签名权限，Linux 需要 ptrace 许可，Windows 使用 LLVM 的 lldb-dap。

所有 provider 选项都在 `options` 对象内，由 provider 的 JSON Schema 校验；未知字段失败，不透传到 DAP 根请求。

### 6.6 命名配置

工作区文件 `.dsh/debug.json` 保存命名配置和复合配置：

```json
{
  "version": 1,
  "configurations": [
    {
      "name": "Node: current file",
      "type": "node",
      "request": "launch",
      "program": "${file}",
      "cwd": "${workspaceFolder}",
      "stopOnEntry": false
    },
    {
      "name": "Python: module",
      "type": "python",
      "request": "launch",
      "module": "app",
      "cwd": "${workspaceFolder}",
      "options": { "justMyCode": true }
    }
  ],
  "compounds": [
    {
      "name": "API + worker",
      "configurations": ["Node: current file", "Python: module"],
      "stopAll": true
    }
  ]
}
```

支持的变量替换：`${workspaceFolder}`、`${file}`、`${relativeFile}`、`${fileBasename}`、`${fileDirname}`、`${env:NAME}`。不支持命令替换、任意 JS 求值或网络引用；未解析变量启动失败并指出字段。`${env:NAME}` 的值只在运行时使用，日志、通知和 UI 中脱敏。

配置 schema 版本化；未知顶层字段、重复名称、空 configurations 失败。命名配置与内联请求互斥，避免两个默认值来源。

## 7. 执行世界

### 7.1 跟随现有 provider

调试服务不直接使用 Node `child_process` 或 `fs`。适配器、目标进程、文件读取和路径探测全部通过当前组合的 `ctx.subprocess`、`ctx.fs` 和 `ctx.workingDirectory`。因此：

- 本机组合得到本机进程和本地路径。
- SSH 组合得到远端进程和远端路径；DAP 走 SSH stdio 或隧道。
- 沙箱组合得到受限进程和沙箱可见路径；策略决定 ptrace/网络是否允许。

### 7.2 路径

- `workspaceRoot`、`cwd`、`program` 都是执行世界中的路径；editor 的 resource address 通过现有 `workspace-files` 映射。
- 模型工具返回工作区相对路径，便于模型使用；UI 使用 `dsh-resource://file/...` 地址。
- 断点按工作区相对路径持久化；provider 在 `resolve` 中转成适配器需要的绝对路径。
- Windows 路径使用执行世界报告的 `pathSeparator`；不假设 `/`，不用宿主路径规则处理远端路径。

### 7.3 SSH

- launch 和 stdio attach 走 `ctx.subprocess` 的 SSH provider，无需端口转发。
- 需要 TCP/WebSocket 的 attach 由 SSH provider 建立本地监听并转发到远端端口；建立失败返回 `DEBUG_ATTACH_UNSUPPORTED`。
- 适配器必须在远端执行世界存在；托管安装优先在远端下载/校验。远端不可下载时，用户必须在远端预装并配置路径。禁止用宿主适配器调试远端目标。
- SSH 断线：会话进入 `failed`，保留有界错误详情；目标进程由远端系统策略处理，不假装仍在运行。

### 7.4 沙箱

- 适配器和目标进程都在沙箱内启动；`ctx.sandbox` 在 spawn 前包装 argv，调试器不得绕过。
- provider 声明所需能力：`ptrace`（Delve/lldb）、`processControl`、`networkListen`（attach）。沙箱策略不足时启动前返回 `DEBUG_SANDBOX_DENIED`，并给出修改策略的明确说明。
- macOS Seatbelt 下 launch 通常可行；attach 到其他进程可能因 `task_for_pid` 权限失败，按能力报错。Linux bwrap/Landlock 下 ptrace 需要策略允许；不允许时 launch 可能仍可用，attach 不可用。
- 沙箱内无法安装适配器时，用户必须在沙箱可见的只读路径预装；托管安装失败不自动回退到宿主。

### 7.5 进程树与清理

- 适配器和目标进程作为同一执行世界中的进程树管理；终止会话时先请求适配器，再等待进程树退出，超时后强制终止。
- 会话所有者释放、工作区归档和 Host 关闭都走同一清理路径。
- 归档 admission 按 Session 生效：`ctx.workspaceRegistry` 的 `workspace/session-activity`（waterfall，报告）与 `workspace/session-stop`（parallel，终止）以 `archiveSession(sessionId)` 为键，现有家族是 `turn`、`job`、`subagent`、`schedule`。`debug` 家族注册同一对事件，报告并终止该 Session 拥有的会话，一次一个。这正是第 4.3 节要求每个 launch/attach 都带发起 Session 的原因：没有 Session 归属就没有报告入口，会话只能等 Host 关闭才清理。
- 适配器崩溃或 stdio 关闭时，会话进入 `failed`；目标进程按 provider 的 `killOnDisconnect` 策略处理，行为写入 error detail。

## 8. Agent 工具与唤醒

### 8.1 工具清单

| 工具 | 操作 |
|---|---|
| `debug_session` | `launch`、`attach`、`launch_compound`、`list`、`list_compounds`、`get`、`get_compound`、`terminate`、`terminate_compound`、`disconnect`、`attach_targets` |
| `debug_execution` | `continue`、`pause`、`step_over`、`step_in`、`step_out`、`step_back`、`restart`、`restart_frame`、`wait_for_stop` |
| `debug_inspect` | `threads`、`stack_trace`、`scopes`、`variables`、`evaluate`、`set_variable`、`set_expression`、`completions`、`exception_info`、`modules`、`loaded_sources`、`source`、`disassemble`、`read_memory`、`write_memory`、`console` |
| `debug_breakpoints` | `set_file`、`set_function`、`set_exception`、`set_data`、`set_instruction`、`list`、`clear` |

操作使用封闭 union；新增操作是编译期强制变更，所有消费者 `switch` 到 `assertNever`。工具参数中的行号和列号从 1 开始，与 seam 一致。

`debug_breakpoints` 默认调用服务级断点写入，作用于持久化集合和全部匹配的活动会话；只有显式传入 `sessionId` 时才限定到单会话。

### 8.2 工具结果

- 每个结果都有 `sessionId`、`state`、`truncated`、`total`（适用时）和结构化字段；复合操作额外携带 `compoundId` 和子会话列表。
- `stack_trace` 返回工作区相对路径和 1-based 行列；`variables` 返回当前层值与子引用；`evaluate` 返回字符串、类型和可选子引用。
- `console` 使用偏移游标；工具结果携带下一次读取的 `nextOffset`。
- `launch` 返回会话能力、初始状态和是否停住；不返回适配器原始响应。
- 错误使用 `DebugError` 的 code 和可操作 detail；不把 stderr 全文塞进模型上下文，只给末尾有界片段。
- 工具卡片：`presentCall` / `presentResult` 保持纯函数；Web 卡片从 `tool/call`、`tool/result` 和 `result.meta` 派生，不导入 Host 实现。栈帧位置通过 `locations` 让编辑器跟随。

### 8.3 系统提示词

新增固定提示段，说明：

- 当失败依赖运行时状态、仅靠读代码和测试无法解释时，使用 `debug_*`。
- 启动前先设置断点；停住后先看线程、栈、作用域，再决定单步或继续。
- 只对必要的最小表达式求值；内存写入需要明确理由和审批。
- 自己启动的会话在结束前终止；不要留下后台调试进程。
- 普通代码导航使用文件/LSP 工具，不用调试器代替搜索。

提示词文本在测试中固定，避免模型行为漂移。

### 8.4 停住唤醒

- 非 Agent 命令直接导致的停住（断点、异常、人工继续后的停住）产生 `debug/stopped` 事件，并由 `tool-debug` 生成有界通知。
- 通知通过 `Agent.send(message, target, wakeup)` 投递（`packages/core/agent-loop`）：`wakeup: false` 在忙时注入下一步，`wakeup: true` 在空闲时打开新 turn。投递策略与循环上限由 `tool-debug` 自己的 Config 字段 `debugStopDelivery` 和 `debugMaxConsecutiveWakes` 决定。后台任务的 `completionDelivery`/`maxConsecutiveWakes` 是 `dsh-tool-jobs` 的字段，debug 不读取、不共用，也不改这两个包里的名字。
- 通知内容包含会话 id、原因、线程、工作区相对位置和下一步建议；不包含变量值、环境变量或源码片段。
- Agent 自己发起的 `continue`/`step` 等到停住后直接返回结果，不再额外唤醒；若工具调用被取消或超时，后续停住按普通通知处理。
- 人工拥有的会话默认 `quiet`，Agent 拥有的会话默认 `wakeup`；工作台按会话提供「通知 Agent」和「允许 Agent 控制」两个独立开关。Agent 始终可以 `list`/`get` 同工作区会话，但控制操作受第 8.5 节授权约束。
- 通知是 `user/message`，来源通过 `MessageSourceMap` 声明为 `debug`；因此模型可见且可重放。

### 8.5 权限与审计

- Agent 发起 `launch`/`attach` 通过现有 `ctx.approval` 请求审批；无回答者的 headless/SDK 组合按现有 fail-closed 规则拒绝，除非部署显式提供回答者。
- 人从工作台点击启动/附加是直接用户操作；UI 仍需确认对话框，展示程序、参数、工作目录、适配器和安全提示。
- 已存在会话的控制不逐次审批，但授权按会话授予，不是按工作区默认全开。`evaluate`、`setVariable`、`setExpression`、`writeMemory` 会在目标进程内执行任意代码，`readMemory`、`source`、`console` 会读出该进程已加载的密钥与源码，因此：Agent 控制自己创建的会话默认允许；控制人创建的会话默认 `DEBUG_CONTROL_NOT_GRANTED`，需要人在工作台打开该会话的「允许 Agent 控制」，或对该次调用单独审批。被提示注入的 Agent 因此拿不到「人正在调试的那个进程」的默认读写面。
- 所有控制写入 `debug/control` 审计事件，包含 actor、操作、线程/帧、结果和授权来源（默认允许、会话开关、单次审批）。
- `write_memory` 默认禁用；启用后每次调用仍需审批。`set_variable`/`set_expression` 在已批准会话内允许，但记录审计。
- 跨工作区会话不可见；工作区归档终止会话。

### 8.6 Session 事件与投影

新增耐久事件（`SessionEventMap` 声明合并，`ignorable: true`）：

| 事件 | 载荷 |
|---|---|
| `debug/session-started` | sessionId、providerId、language、mode、workspaceRoot、configurationName、adapterVersion |
| `debug/stopped` | sessionId、reason、threadId、source（相对路径）、line、column、description |
| `debug/session-ended` | sessionId、outcome（terminated/disconnected/failed）、reason、durationMs |
| `debug/control` | sessionId、actor、operation、threadId/frameId（仅审计） |

`frameId`、`variablesReference` 是会话内瞬时引用；耐久事件中的数值只用于审计和定位，重放不得当作可继续使用的句柄。每个新事件按仓库规则声明 `@mode` 和载荷 `@param`，并在 `MessageSourceMap` 中声明 `debug` 来源。

不记录变量值、内存、环境变量值、原始 DAP 帧、断点列表和 console 全文。`continued` 只走 live 事件；断点持久化在 storage，工具调用本身已记录。

`SESSION_FORMAT_VERSION` 不因这些新增事件升级：事件信封标记 `ignorable: true`，未加载 debug 插件的 reader 会安全跳过；已加载插件时投影重建会话生命周期和最后一次停住位置。若后续需要改变已有判别式语义，再按持久化规则升级。

`dsh-debug` 注册 `debugSessions` Session 投影，折叠上述事件为 `{ id, providerId, state, lastStop }`，用于重连和会话列表；投影不进入系统提示词，模型通过工具查询。

TS 与 Python SDK 的预期输出在同一变更中更新，因为 `SessionEventMap` 是两者共同投影的循环事实。

## 9. 客户端体验：工作台与终端

### 9.1 包与职责

- `ui-code-editor`：CodeMirror 6 编辑器、标签页、断点槽、当前行、查找替换、脏状态、保存冲突提示、只读虚拟源。
- `ui-debug`：调试工具条、线程选择、调用栈、作用域/变量、监视、断点列表、控制台、模块、已加载源、反汇编、内存、异常过滤器、适配器设置页。
- `ui-workbench`：工作台页面与停靠布局，复用文件树和终端；注册命令、快捷键、面板服务 `ctx.workbenchPanels`。
- `api/debug-controller`：把 `ctx.debug` 暴露为带类型的 Remote 方法和事件流；处理 Session 身份、工作区授权和重连快照；编辑器保存所需的 `ctx.fs` 版本守卫写也在这里暴露（第 10 节）。
- `apps/tui` / `tui-debug`：终端应用、轻量会话记录与输入、全屏调试面板、命令模式和源码预览；直接消费 `ctx.debug`，见 9.8。

### 9.2 布局

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Workbench toolbar: config picker · debug controls · session · actor  │
├──────────────┬───────────────────────────────────────┬───────────────┤
│ Files        │ Editor tabs                           │ Debug panels  │
│ (workspace)  │  gutter · current line                │ Threads       │
│              │                                       │ Call stack    │
│              │                                       │ Variables     │
│              │                                       │ Watch         │
│              │                                       │ Breakpoints   │
│              │                                       │ Console       │
├──────────────┴───────────────────────────────────────┴───────────────┤
│ Terminal (existing) · Debug output                                   │
└──────────────────────────────────────────────────────────────────────┘
```

Web/Desktop 工作台是主区域的一个页面/标签，与对话并存；从对话中的调试工具卡或停住通知可一键聚焦对应会话和源码位置。布局使用现有 `ui-dockkit`：分割树、标签页、可翻转操作和布局历史；布局状态按客户端持久化，不进入 Session。CLI 的终端布局见 9.8。

文件树复用 `ui-sidebar-files` 的展示与 Remote 读取逻辑，抽取为可嵌入组件，Sidebar 和工作台作为两个 embedder，不复制文件树实现。终端复用 `ui-sidebar-terminal` 与 `ctx.terminalController`。窄屏折叠为「编辑器 + 底部面板」，调试面板变成标签；低于最小宽度时提示使用桌面端，但保留基本操作。

`ui-workbench` 暴露客户端服务 `ctx.workbenchPanels`，允许 `ui-code-editor`、`ui-debug` 和未来的工具注册面板：

```text
interface WorkbenchPanelRegistry {
  register(contribution: {
    id: string
    title: LocalizedText
    icon: IconRef
    component: ComponentType
    defaultLocation: 'left' | 'center' | 'right' | 'bottom'
    order?: number
  }): () => void
}
```

注册是 effect，disposer 移除面板；重复 id 冲突在注册时失败，不覆盖。布局只保存面板 id 和停靠位置，不保存 React 组件或业务状态。

### 9.3 编辑器

- CodeMirror 6，按需加载 JavaScript/TypeScript、Python、Go、Rust、C/C++ 语法包；未知扩展回退纯文本。
- 通过 `workspace-files.readBytes` 读取完整文件并按 UTF-8 解码，保留原始换行风格；超过 `maxEditorFileBytes` 或非 UTF-8 拒绝编辑，给出明确提示。
- 工作区外的文件只读打开；保存方法在解析路径后拒绝工作区外写入。
- 断点槽：单击切换断点；右键设置条件、命中次数、日志点、启用/禁用；未验证断点显示空心图标；拖动断点位置时更新行号并重新应用。
- 当前行：停住事件到达时打开对应文件、滚动到行列并高亮；栈帧点击导航；虚拟源使用只读标签。
- 悬停求值：仅在 `supportsEvaluateForHovers` 时启用，调用 `evaluate` context `hover`，结果有界；不自动求值副作用表达式。
- 查找/替换：CodeMirror 搜索扩展，支持当前文件；跨文件搜索沿用现有文件/搜索工具，不在 v1 重做。
- 保存：Cmd/Ctrl+S，携带打开时的 `version`；成功后更新版本，失败按第 10 节处理；关闭脏标签需确认。
- 外部变更：干净标签通过 `workspace-files.changes` 自动刷新；脏标签标记「磁盘已变更」，保存时产生冲突。
- 多标签：每个文件一个标签，同一文件不重复打开；标签固定/关闭；激活标签与调试位置联动但不强制抢焦点。
- 只读模式：调试虚拟源、反汇编、只读依赖文件；工具栏显示只读标记。

### 9.4 调试面板

- 工具条：启动/重启、继续/暂停、单步（over/in/out/back）、重启帧、停止/断开、线程/goroutine 选择、会话选择、Agent 通知开关、Agent 控制授权开关、actor 指示；人可以接管 Agent 启动的会话，Agent 只有在该会话授予控制权限后才能接管人启动的会话（第 8.5 节）。
- 调用栈：按线程显示帧，虚拟化列表；点击帧切换作用域；分页加载延迟栈。
- 变量：作用域分组，懒加载子节点，复制值/复制表达式，能力允许时内联编辑；大值折叠并显示字节/字符上限。
- 监视：按工作区持久化的表达式列表；停住时刷新；求值失败显示错误码和简短原因，不阻塞其他监视。
- 断点：文件断点、函数断点、异常过滤器、数据断点、指令断点分组；启用/禁用、条件、命中次数、日志点；未验证原因可见。
- 控制台：REPL 历史、求值结果、目标程序 stdout/stderr、适配器输出分类；ANSI 支持时渲染，不支持时纯文本；输出环有界，显示截断提示。
- 模块/已加载源：能力允许时显示模块列表、加载状态、源引用；点击打开只读源。
- 反汇编/内存：能力允许时显示；内存写入默认隐藏，启用后每次确认。
- 适配器设置：已安装版本、平台、许可证、SHA-256、安装/更新/卸载、覆盖路径、自检结果；安装进度可取消。

所有面板按能力隐藏或禁用，不显示会失败的操作。空状态说明下一步，例如“尚未启动调试会话”“此适配器不支持数据断点”。

### 9.5 Remote 契约

Web/Desktop 的 `api/debug-controller` 暴露：

- unary：`launch`、`attach`、`launchCompound`、`list`、`get`、`listCompounds`、`getCompound`、`setBreakpoints`、`setExceptionBreakpoints`、`setFunctionBreakpoints`、`setDataBreakpoints`、`setInstructionBreakpoints`、`continue`、`pause`、`step`、`restart`、`restartFrame`、`terminate`、`disconnect`、`threads`、`stackTrace`、`scopes`、`variables`、`evaluate`、`setVariable`、`setExpression`、`completions`、`exceptionInfo`、`modules`、`loadedSources`、`source`、`disassemble`、`readMemory`、`writeMemory`、`console`、`attachTargets`、`restartCompound`、`terminateCompound`。
- stream：`events(sessionId, after)` 回放 `after` 之后的环内事件再续接 live（第 9.5.1 节），推送状态、停住、继续、断点验证、控制台输出和适配器输出；`output(sessionId, offset)` 用于补偿读取。
- 编辑器保存所需的 `writeText(sessionId, path, content, expectedVersion | null)` 也在该控制器暴露，内部走 `ctx.fs` 的版本守卫写（第 10 节）。
- 方法按资源分组声明（session、execution、inspect、breakpoints、editor），组内名称、参数与返回类型直接引用 `packages/debug` 的 seam 类型，控制器不重命名方法、不复定义参数对象，也不把 `Debug*` 类型复制成客户端镜像。
- 每个方法都带 Session 身份，Host 从 Session 解析工作区和执行世界，不信任客户端传入的根路径。
- 重连：见 9.5.1。
- 授权沿用 `remote-access`：同一工作区可见；非工作区成员不可见；Agent 和人工控制都记录 actor。

TUI 不使用该 Remote 层；它在同一 Host 进程内直接注入 `ctx.debug`，因此没有浏览器传输和远端访问过滤。`tui` profile 只服务本机用户。

#### 9.5.1 重连与事件游标

`api/debug-controller` 为每个调试会话维护单调递增的 `debugEventSeq` 和有界回放环。`get` 返回 `{ session, eventSeq }`；`events(sessionId, after)` 先回放环中 `after` 之后的事件，再续接 live。若 `after` 早于环起点，返回 `debug/event-cursor-expired`，客户端重新 `get`。这样停住事件不会在快照和订阅之间丢失。

### 9.6 工具卡与对话

- `debug_session` 卡片显示会话、语言、状态、适配器和位置；`debug_breakpoints` 显示文件/行/条件/验证状态；`debug_execution` 显示停住原因和位置；`debug_inspect` 显示有界结果。
- 卡片通过 `tool.call.toolview` 注册，从原始事件和 `result.meta` 派生，支持 Session 回放；没有专用卡片的 UI 回退到通用卡片。
- 停住通知在对话中显示为一条调试消息（`user/message`，来源 `debug`），可点击打开工作台；不重复渲染完整变量树。
- Web 客户端不消费 Host 的 `presentCall`/`presentResult`，两者保持纯函数，UI 适配器负责本地校验和回退。

### 9.7 快捷键与无障碍

- F5 继续/启动，Shift+F5 停止，F9 切换断点，F10 单步跳过，F11 单步进入，Shift+F11 单步跳出，Cmd/Ctrl+S 保存。
- 焦点管理：停住时不强制抢焦点，除非用户启用“停住时聚焦”；屏幕阅读器播报停住原因和位置；断点槽可键盘操作。
- 面板、按钮和树使用语义化角色与标签；颜色对比满足现有主题；动画尊重 reduced motion。
- 所有文案走 typed locale dictionaries，英文使用 sentence case。

### 9.8 CLI / TUI

#### 9.8.1 形态

- 新增随应用发布的 `tui` profile，通过 `dsh tui` 启动；它加载 `dsh-base`、`apps/tui` 和 `tui-debug`，不加载浏览器传输层。
- TUI 是终端 Agent 客户端，不是只有调试面板：默认显示纯文本会话记录和输入行，用户可以直接向 Agent 提问；工具调用以文本摘要出现，长输出可用命令展开。
- TUI 启动一个交互式 Session（可用 `--session-id` 恢复），复用现有 agent/session 服务；对话记录进入同一 Session 日志，不新建会话存储。
- `F6` 切换会话/调试工作区，`F7` 进入分屏；调试工作区显示调用栈、变量、监视、断点、控制台和源码预览，并提供 `:` 命令模式。人与 Agent 共用同一进程内的 `ctx.debug`。
- TUI 不内嵌代码编辑器。源码只读预览，按 `o` 用 `$EDITOR` 或配置的远程编辑器打开当前 `file:line`；编辑仍走现有文件工具或外部编辑器。
- TUI 不追求 Web 的富卡片、Markdown 或图片渲染；工具结果以纯文本摘要呈现，完整内容按需展开。这是 CLI 的明确产品边界，不是临时缺口。
- `dsh headless --json` 是自动化路径，不是 TUI 的替代品：它输出机器可读的调试事件，供脚本和 CI 消费。
- TUI 直接注入 `ctx.debug`、`ctx.fs`、`ctx.workspace`、`ctx.agents` 和 `ctx.sessions`，因为它在同一 Host 进程内运行；审批通过终端回答者接入现有 `ctx.approval`，不新增权限旁路。
- 退出 TUI 时，若仍有运行中的调试会话，先提示用户；Host 退出按第 7.5 节清理，不留下孤儿进程。
- 终端渲染采用 Ink（React 终端渲染，MIT），版本固定。组件与交互测试用 ink-testing-library；完整终端行为（raw 模式、尺寸变化、`NO_COLOR`）用 PTY 驱动，node-pty 只作为测试侧 devDependency，运行时零 PTY 依赖：TUI 渲染自身 stdout，适配器经 `ctx.subprocess` 管道启动，`runInTerminal` 复用 `ctx.terminals`（服务键 `terminals`）。面板注册、键位和命令都通过 effect 注册与释放，不建立新的全局单例。

#### 9.8.2 布局与键位

```text
Chat（默认）
┌ status: session · model · debug state · actor ───────────────────────┐
├ transcript: user / assistant / tool summaries ───────────────────────┤
├ input >                                                             ─┤
└ : command line ──────────────────────────────────────────────────────┘

Split（F7）
┌ status ───────────────────────────────────────────────────────────────┐
├ transcript ─────────────────────┬ debug panes ───────────────────────┤
│                                 │ call stack / variables / watch     │
├ input > ────────────────────────┴────────────────────────────────────┤
└ : command line ──────────────────────────────────────────────────────┘

Debug（F6）
┌ status: session · provider · state · actor ──────────────────────────┐
├ call stack ──────────────┬ variables / watch ────────────────────────┤
│ frame 0                  │ scope → value                              │
│ frame 1                  │ watch expressions                          │
├ breakpoints ─────────────┴ console / output ─────────────────────────┤
│ source preview: path:line, current-line marker                       │
├──────────────────────────────────────────────────────────────────────┤
│ : command line                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

- F6 切换会话/调试工作区，F7 分屏，Tab 切换焦点；输入行中直接输入文本并回车发送给 Agent，行首 `:` 进入命令模式。
- 调试快捷键只在 debug pane 有焦点时生效：F5 继续/启动，Shift+F5 停止，F9 切换断点，F10 单步跳过，F11 单步进入，Shift+F11 单步跳出，`o` 打开编辑器，`g` 跳转文件/行，`/` 过滤，`?` 帮助。输入框中的按键不被调试快捷键拦截。
- 最小可用尺寸 80×24；更窄时折叠为「状态 + 当前帧 + 控制台」，命令模式仍可用。尊重 `NO_COLOR` 和 `TERM=dumb`，无颜色时用前缀标记语义。
- 终端大小变化、焦点和滚动位置由 TUI 自己的布局状态持有，不写入 Session。

#### 9.8.3 命令

| 命令 | 作用 |
|---|---|
| `:chat` / `:debug` / `:split` | 切换会话、调试或分屏布局 |
| `:expand <n>` | 展开最近第 n 条工具结果或长输出 |
| `:run [config]` | 启动命名配置或当前文件 |
| `:attach <pid\|port\|url>` | 附加到目标 |
| `:break <file>:<line> [if <expr>] [log <text>]` | 设置行/条件/日志点 |
| `:break off <file>:<line>` | 移除断点 |
| `:exception [filter]` | 配置异常断点 |
| `:continue` / `:pause` / `:next` / `:step` / `:out` / `:back` | 执行控制 |
| `:bt [thread]` / `:frame <n>` | 调用栈与帧切换 |
| `:vars` / `:eval <expr>` / `:watch <expr>` | 变量、求值、监视 |
| `:threads` / `:sessions` / `:switch <id>` | 线程与会话切换 |
| `:terminate` / `:disconnect` | 结束或断开 |
| `:adapter list` / `:adapter install <provider>` | 适配器管理 |
| `:help` / `:quit` | 帮助与退出 |

命令行按 argv 规则解析，不经过 shell；表达式和日志文本作为单个参数传入，避免命令注入。输入行不是 shell，不执行 `!` 或命令替换；需要本地命令时使用 Agent 或现有终端。模型工具使用 JSON 参数，不解析这些人类命令。

#### 9.8.4 源码预览

- 通过 `ctx.fs` 读取当前执行世界的源码窗口，显示路径、行号和当前执行行；大文件只取窗口。
- 本地工作区按 `o` 调用 `$EDITOR +<line> <file>`；SSH 工作区调用配置的远程编辑器命令（例如 `code --remote`），未配置时显示可复制的远程路径，不假装本地路径可用。
- 预览是只读的；TUI 不提供保存、查找替换或多标签编辑。需要编辑时使用外部编辑器或 Agent 文件工具。

#### 9.8.5 headless 自动化

- `dsh headless --json` 在现有 NDJSON 运行事件之外输出 `debug/session-started`、`debug/stopped`、`debug/session-ended`、`debug/control`，字段与 Session 事件一致；工具调用和结果仍通过现有 `tool/call`、`tool/result` 事件出现。
- 不输出原始 DAP 帧、变量值、内存内容或环境变量值；`debug_inspect` 的模型可见结果仍按工具结果上限截断。
- 脚本通过 `sessionId` 关联事件；`debug/stopped` 后可以调用 `debug_inspect`，也可以由 Agent 自动唤醒处理。
- headless 没有审批回答者时 launch/attach 仍 fail-closed；CI 必须预装适配器并配置覆盖路径，或在部署中提供回答者。`--json` 不改变权限。
- NDJSON 字段属于机器可读接口，变更遵循现有 SDK/线协议兼容策略；不在 v1 承诺原始 DAP 兼容。

#### 9.8.6 TUI 测试

- 使用 PTY 驱动真实终端应用，覆盖按键、命令解析、面板折叠、尺寸变化、`NO_COLOR` 和无颜色输出。
- 覆盖会话输入、流式回复、工具摘要、长输出展开、停住通知和焦点切换；验证输入框不会触发调试快捷键。
- 终端快照验证状态栏、栈、变量、断点和控制台；`$EDITOR` 调用使用可注入的测试命令。
- `dsh headless --json` 使用固定 NDJSON 快照，覆盖停住、继续、终止、审批拒绝和适配器缺失。
- 三端共享同一假适配器和同一组场景，验证 Web/Desktop/CLI 的归一化状态一致。

## 10. 文件编辑与保存

编辑器保存不新建包。`ctx.fs` 已经提供跨执行世界的原子文本写与字面编辑，并把版本守卫做成可选参数：`stat`/写/编辑结果返回不透明 `FsVersion`，写入侧的 `replaceIfVersion` 守卫在文件自上次观察后变化时抛 `FS_STALE_VERSION`，失败类型统一是带稳定 code 的 `FsError`。seam 侧已定义 target/version 词表，`dsh-fs-observation-policy` 已承载 read-before-edit 与版本守卫策略。因此本设计只新增一个 Remote 方法，把现有能力按 Session 身份暴露给编辑器：

```text
writeText(sessionId, path, content, expectedVersion | null): Promise<{ version, bytes }>
```

- `api/debug-controller`（或现有 `workspace-files` 控制器）实现该方法：`path` 解析到 Session 工作区根内，拒绝最终符号链接逃逸、目录、NUL、非 UTF-8 和超限内容，Host 从 Session 解析执行世界，不信任客户端传入的根路径。
- `expectedVersion: null` 走 unconditional create-or-overwrite 之外的 create 路径；目标已存在时返回冲突与当前版本，不覆盖。
- 已有文件必须携带打开时的 `version`；`FS_STALE_VERSION` 原样映射成冲突，并附当前版本供客户端重新加载。
- 客户端冲突 UI 提供「重新加载」「保留我的更改」「另存为」；「覆盖」需要二次确认。Agent 不调用该 Remote 方法，继续使用现有 `dsh-tool-fs` 路径，避免两条编辑通道。
- 不提供 rename/delete/mkdir；这些继续由现有文件管理能力完成，避免写入面扩大。
- 原子性、执行世界路径规则、二进制拒绝都由 `ctx.fs` 后端负责，编辑器层不复制这些规则；不支持版本守卫的后端按 `ctx.fs` 的既有降级语义处理，seam 不额外制造版本。
- 该接口只服务 Web/Desktop 编辑器；TUI 不调用它，源码预览只读，编辑走 `$EDITOR` 或 Agent 文件工具。

## 11. 持久化

| 数据 | 位置 | 生命周期 |
|---|---|---|
| 断点、条件、命中次数、日志点 | `ctx.storageDomain` 声明的 `debug-breakpoints` domain | 跨 Host 重启保留 |
| 监视表达式 | 同上 | 跨 Host 重启保留 |
| 命名 launch/attach/compound 配置 | `.dsh/debug.json` | 随工作区版本管理 |
| 调试会话、变量、内存、控制台 | 进程内 | Host 重启即结束 |
| 会话生命周期/停住/控制审计 | Session 日志 `debug/*` | 随 Session 持久化 |
| 编辑器脏草稿（Web/Desktop） | 客户端有界草稿存储 | 跨标签切换和页面刷新保留；不进入 Session |
| 工作台布局、打开的标签 | 客户端本地状态 | 按客户端保留 |
| TUI 布局、命令历史 | 客户端本地状态 | 按终端进程保留；不进入 Session |
| TUI 会话记录/工具摘要 | Session 日志 | 随 Session 持久化；TUI 只渲染摘要 |

TUI 不保留脏草稿；未保存内容由 `$EDITOR` 自己管理。TUI 的对话和工具结果来自 Session 日志，不另建历史存储。

断点记录按工作区 id 和相对路径存储，版本化 schema；工作区移动或重命名时按工作区实体身份保留，不按绝对路径重建。`ctx.storageDomain` 是按 `defineDomain({ name, version, tables, global? })` 声明的通用 KV 设施，本身不带工作区作用域：工作区隔离由 domain 名与 `workspaceId` + 相对路径构成的记录键实现，这一点写进 `debug-breakpoints` domain 的声明而不是依赖设施默认。存储写入失败不得静默：断点仍可在当前会话生效，但 UI 显示“未持久化”，下次启动前提示。

## 12. 安全与权限

### 12.1 启动与附加

- Agent 发起 launch/attach 必须通过 `ctx.approval`；无回答者时 fail-closed。
- 人工操作通过 UI 确认对话框；显示程序、参数、工作目录、适配器、执行世界和安全提示。
- attach 比 launch 更敏感：默认总是显示确认；配置不能默认关闭人工确认。Agent attach 每次请求审批，不能复用 launch 的一次性授权。
- 附加目标按 PID/端口/URL 显式指定；进程选择器只通过 provider 声明的命令读取，不调用宿主 OS API。

### 12.2 适配器供应链

- 清单固定版本与 SHA-256；安装前校验，校验失败删除文件并报错。
- 只允许仓库清单中的来源；用户自定义命令是显式覆盖，风险提示随 UI 展示。
- 不自动更新；会话进行中禁止安装/更新/卸载。
- 许可证和第三方声明进入 `THIRD_PARTY_NOTICES.md`；安装目录保留许可证文本。
- 托管安装和调试过程不继承不必要的凭据；环境变量按 provider 白名单传递，日志脱敏。

### 12.3 代码执行与内存

- `evaluate`、`setVariable`、`setExpression` 在目标进程内执行代码，可能产生副作用；工具描述明确警告，审计记录表达式或变量名（不是值）。这三项加 `readMemory`、`source`、`console` 构成「会话创建后即可获得目标进程的代码执行与数据读出」，所以控制授权按会话授予而非默认全开（第 8.5 节）。
- `writeMemory` 默认禁用；启用后每次审批，审计记录地址和长度，不记录内容。
- `readMemory` 可能暴露敏感数据；工具结果按上限截断，UI 只在明确打开内存面板时读取。
- 调试输出、变量和环境值不进入产品遥测；调试 trace 默认关闭，开启时脱敏。

### 12.4 执行世界

- 沙箱策略不得被调试功能绕过；所需能力通过 provider 声明并在启动前检查。
- SSH 世界不自动使用宿主适配器；远端安装/预装是唯一路径。
- 工作区归档、Session 删除和 Host 关闭都终止会话，避免残留进程。

### 12.5 三端安全差异

- Web：适配器安装在 Host 或所选执行世界，浏览器永远不下载或执行适配器；会话可见性由 `remote-access` 决定。
- Desktop：原生进程选择器只列出 provider 声明可发现的进程；OS 通知只包含位置和停住原因，不含变量值；菜单和全局快捷键不能绕过审批。
- CLI/TUI：审批通过终端回答者进入现有 `ctx.approval`；`$EDITOR` 调用是本地用户动作；SSH 远程编辑器命令必须显式配置；headless 无回答者时 launch/attach fail-closed。
- `--json`、TUI 命令和 Web 按钮都不能绕过同一套审批、沙箱和工作区边界。

## 13. 失败处理与限制

| 场景 | 行为 |
|---|---|
| 适配器未安装 | `DEBUG_ADAPTER_NOT_FOUND`，UI 打开安装入口，Agent 收到安装指引 |
| 校验和不匹配 | `DEBUG_ADAPTER_CHECKSUM`，删除下载物，不启动 |
| 适配器启动失败 | `DEBUG_LAUNCH_FAILED` + stderr 末尾有界片段 + provider 提示 |
| initialize 超时 | `DEBUG_TIMEOUT`，终止适配器进程树 |
| 适配器崩溃 | 会话 `failed`，保留最后状态和 stderr 尾部；通知所有者 |
| 运行中读栈 | `DEBUG_NOT_STOPPED`，不返回空结果 |
| 继续后使用旧引用 | `DEBUG_STALE_REFERENCE`，提示重新读取栈/变量 |
| 适配器不支持能力 | `DEBUG_UNSUPPORTED_CAPABILITY`，UI 隐藏对应操作 |
| 沙箱拒绝 ptrace | `DEBUG_SANDBOX_DENIED`，说明需要的策略 |
| SSH 断线 | 会话 `failed`，不重试目标程序 |
| Host 重启 | 会话丢失；客户端 `DEBUG_SESSION_GONE`，UI 显示已结束 |
| headless 无审批回答者 | `DEBUG_APPROVAL_DENIED`，提示配置回答者或预装/覆盖适配器 |
| TUI 远程编辑器未配置 | 显示可复制的远程路径，不打开错误的本地路径 |
| 文件保存冲突 | `FS_STALE_VERSION` 映射为冲突并附当前版本，UI 提供重新加载/保留/另存 |
| 输出超限 | 有界环 + `truncated`，不阻塞会话 |
| 变量过大 | 单次读取上限 + 子引用，模型显式分页 |

限制字段全部通过 Config 暴露，默认值仅作为默认，不是唯一可调值：`maxSessions`、`maxBreakpointsPerFile`、`maxBreakpointsTotal`、`initializeTimeoutMs`、`launchTimeoutMs`、`requestTimeoutMs`、`terminateTimeoutMs`、`maxMessageBytes`、`maxStackFrames`、`maxThreads`、`maxVariablesPerPage`、`maxValueChars`、`maxConsoleBytes`、`consoleRingBytes`、`eventRingBytes`、`adapterStderrBytes`、`maxNoticeBytes`、`debugStopDelivery`、`debugMaxConsecutiveWakes`、`debugControlDefault`、`maxEditorFileBytes`、`maxDraftBytes`、`allowMemoryWrite`。

协议常量、DAP 版本、校验和验证和沙箱不绕过是固定安全不变量，不放入可调配置。

## 14. 可观测性

- OTel span：`debug.launch`、`debug.attach`、`debug.request`、`debug.adapter.start`；属性包含 surface（web/desktop/cli）、provider、语言、执行世界、能力数量、结果状态、耗时，不包含路径、参数、环境值、源码或变量。
- 产品遥测：会话开始/结束、语言、执行世界、停住原因、是否成功，按现有 telemetry 隐私规则；可通过设置关闭。
- 调试 trace：按会话开启，写入 Host 日志，包含 DAP 方法名、耗时、错误码；不写完整请求体/响应体，不写变量值。适配器 stderr 单独有界保留。
- 错误报告：包含 code、provider、sessionId、平台、执行世界、适配器版本；不包含源码和环境值。

## 15. 测试策略

### 15.1 单元测试

- DAP 分帧、转义、超限、缺失 Content-Length、非法 JSON、重复序号、未知事件。
- 状态机所有合法/非法转换；操作矩阵；终止幂等。
- provider 注册冲突、扩展冲突、解析默认值、变量替换、路径映射。
- 能力协商：每个能力对应 UI/工具可用性；未声明能力拒绝。
- 断点持久化 schema、迁移、工作区身份、相对路径。
- 变量引用失效、分页、截断、ANSI、格式化。
- 所有权：同工作区可控制，跨工作区拒绝；归档终止。
- 适配器安装：校验和失败、平台缺失、版本不匹配、覆盖路径、自检失败。
- 配置校验：未知字段、重复名称、未解析变量、复合配置。
- registry disposer 与 HMR 移除（仓库测试策略要求）。
- 实现遵守仓库的 `no unknown casts`、typed structured failures、`assertNever`、export JSDoc 和 bounded-result 规则。

### 15.2 确定性假适配器

在 `packages/test-support` 提供假 DAP 适配器：

- 通过 stdio 实现 DAP，脚本化产生 breakpoint/exception/step/thread/variable/console 事件。
- 支持能力开关，用于覆盖有/无高级能力。
- 支持注入 malformed 帧、延迟、适配器崩溃、stderr 输出、反向请求。
- 可在本机、SSH fixture、沙箱 fixture 中启动，验证执行世界抽象。
- 单元、e2e、快照和 UI 测试共用；测试不依赖真实语言工具链即可验证完整状态机。

### 15.3 真实适配器 e2e

- Node、Python、Go、Rust/C/C++ 各一个最小程序：断点、条件断点、单步、变量、求值、异常、重启、终止。
- macOS arm64/x64、Linux x64/arm64、Windows x64 的 CI 矩阵；托管安装在 CI 缓存中，失败时输出可操作诊断。
- 每个 provider 增加 attach 测试：PID/端口；SSH 世界至少一个 stdio launch 和一个隧道 attach；沙箱至少一个 launch，ptrace 受限场景断言 `DEBUG_SANDBOX_DENIED`。
- 真实测试按现有策略 self-skip 或缺工具链时明确 skip，不用 mock 替代关键协议路径。

### 15.4 快照与 SDK

- 使用录制的 Session 回放 `debug/*` 事件、工具调用和停住通知；假适配器提供确定性输出。录制路径 `test:snapshot:record` 需要 `DEEPSEEK_API_KEY`，提交后的 `test:snapshot` 回放是 keyless 的；两者不要在同一句话里混称「keyless」。
- 新增 `debugSessions` 投影的快照；验证 Host 重启后投影显示已结束。
- `SessionEventMap` 变更同时更新 TypeScript 和 Python SDK 的预期输出。
- 工具提示词、错误文案、通知文案使用固定快照，防止漂移。
- 记录一个「人 + Agent 交替控制」的会话快照，验证状态一致和审计顺序。

### 15.5 客户端测试

- 浏览器 lane：打开工作台、切换标签、断点槽点击/右键、保存冲突、外部变更、当前行跳转、变量懒加载、控制台游标、重连快照。
- 停住通知点击聚焦对应会话和源码位置；actor 指示正确。
- 窄屏折叠、键盘快捷键、焦点管理和屏幕阅读器播报。
- 工具卡片在回放和实时流下等价；未知/旧数据回退通用卡片。
- 视觉检查覆盖主要面板和暗色主题；不把截图差异当作唯一断言。

### 15.6 真实组合

按 `packages/AGENTS.md`，产品可见插件必须有非 unit 的真实组合测试：通过 Loader 启动 `cordis.yml`，在 Web/Desktop 或 headless 进程中断言模型可见、耐久或用户可见输出。只 mock 外部服务或不确定输入，不把 opt-in 放进默认组合。

### 15.7 三端一致性

- 同一组假适配器场景驱动 Web 浏览器 lane、Desktop E2E、TUI PTY 和 headless NDJSON，比较归一化状态、停住原因、断点验证和错误码。
- 平台差异只允许出现在渲染、输入、通知和适配器来源；任何状态或协议差异都视为缺陷。
- 三端都覆盖“人启动、Agent 接管”和“Agent 启动、人接管”两条路径。

### 15.8 文档与门禁

- `pnpm run doc-sync`：新增 `docs/subsystems/debug.md` 及中文配对、package READMEs、生成目录、链接和字数预算。
- `verify-cordis-catalog`：`ctx.debug`、`ctx.debugAdapters`、`ctx.workbenchPanels` 的生成区域。
- `verify-export-jsdoc`、`doc-typecheck`、`verify-md-wrap`、i18n 配对和客户端 i18n 检查。
- 每文件 100% 覆盖率的 CI 门禁；测试不得依赖单独运行或固定端口。

## 16. 交付计划

一次性全量功能按「可独立验收的内部里程碑」推进，并以堆叠 PR 交付；不把半成品暴露给用户。每层合并前必须通过该层的真实组合测试。

| 里程碑 | 内容 | 验收 |
|---|---|---|
| M0 | `ctx.debug` 契约、状态机、错误、假适配器、投影与 Session 事件骨架 | 假适配器全状态测试；disposer/HMR；快照 |
| M1 | DAP 客户端、适配器管理器、Node provider、本机闭环 | Node launch/断点/单步/变量/求值/终止 e2e |
| M2 | Python、Go、Native provider 与托管安装 | 四语言本机矩阵；安装/校验/覆盖测试 |
| M3 | SSH、沙箱、传输与安装探测 | 远端 launch、隧道 attach、沙箱拒绝路径 |
| M4 | Agent 工具、停住唤醒、审批与审计 | Agent 自主调试；人机交替快照 |
| M5 | Remote 控制器、Web/Desktop 工作台、编辑器、断点槽、面板 | 浏览器 lane 全流程；保存冲突；重连 |
| M6 | CLI 轻量会话、TUI、命令模式、headless NDJSON、三端一致性 | PTY 测试；NDJSON 快照；三端状态一致 |
| M7 | 全部高级面板、复合配置、子会话、性能与安全加固 | 全能力矩阵；文档；发布前检查 |

在 M0–M4 合并期间，debug bundle 与模型侧都不进入默认组合；M4 合并后 headless/SDK/ACP 可经 plugin manager 选择启用模型侧。M5 验收后是否把 debug bundle 移入 Web/Desktop 默认模板，是带采用证据的独立后续决策，不随 v1 交付；`tui` profile 经 `PROFILE_TEMPLATES` 发布并随 M6 验收进入 shipped profile 清单（第 21 节）。

## 17. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| DAP 只标准化协议，不标准化 launch 配置 | 四语言配置差异和测试矩阵大 | provider 显式 `resolve`、独立 schema、真实 e2e 矩阵、固定模板 |
| 沙箱 ptrace/process-control 限制 | attach 或 native 调试不可用 | 启动前能力检查、明确错误、策略文档；不绕过沙箱 |
| SSH 适配器安装与网络 | 远端无法下载或权限不足 | 远端探测、远端安装、预装覆盖、明确指引；禁止宿主回退 |
| 适配器供应链与许可证 | 安全与合规风险 | 固定版本、SHA-256、许可证文本、THIRD_PARTY_NOTICES、人工审批、无自动更新 |
| 原生调试在 macOS/Windows 权限复杂 | 测试不稳定或用户环境失败 | 平台矩阵 CI、权限预检、清晰诊断；attach 能力按平台标记 |
| 完整工作台范围大 | 与现有 Sidebar/终端重复、交付周期长 | 复用现有文件树和终端；ui-dockkit；工作台是主区域页面而非重写全局布局 |
| CLI TUI 与 Web/Desktop 状态漂移 | 三端行为不一致 | 共享 `ctx.debug` 和假适配器场景；三端一致性测试；平台差异只允许在呈现和输入 |
| TUI 终端渲染与键位复杂 | 窄屏、无色终端、SSH 延迟下不可用 | 80×24 最小布局；`NO_COLOR`/`TERM=dumb` 降级；PTY 测试；命令模式兜底 |
| Agent 控制干扰人工调试 | 人和 Agent 互相抢占，被注入的 Agent 拿到人正在调试的进程 | 按会话的控制授权（第 8.5 节）、actor 指示、控制审计含授权来源、按会话通知开关；状态机拒绝非法操作；工作区隔离 |
| 变量/输出过大 | 上下文爆炸、UI 卡顿 | 懒加载、分页、字节上限、有界环、截断元数据 |
| 编辑器保存覆盖并发修改 | 数据丢失 | 版本冲突检测、原子写、外部变更提示、二次确认 |
| Session 事件兼容 | 旧 reader 无法解释新事件 | `ignorable: true`、不升级格式版本、投影仅在插件加载时启用 |
| 假适配器与真实适配器行为差异 | 测试通过但真实失败 | 假适配器覆盖状态机，真实 e2e 覆盖每种语言和世界；共享协议契约测试 |

## 18. 明确延后

- 原始 DAP 请求/响应透传（永不提供）。
- 跨 Host 重启的调试会话恢复。
- 多用户实时协作、调试控制权抢占和 presence。
- 移动端完整 IDE；仅提供窄屏折叠和基本操作。
- TUI 内嵌代码编辑器、多标签编辑和保存；TUI 只提供只读预览与外部编辑器跳转。
- TUI 的富文本、Markdown、图片和完整工具卡片渲染；TUI 只提供纯文本摘要和按需展开。
- 多个独立 TUI 进程共享同一调试会话，或 TUI 连接已运行的 Web/Desktop Host；v1 每个 TUI 运行自己的 Host。
- LSP 补全、诊断、重构与编辑器深度集成。
- 调试会话之间的变量/内存共享。
- 自动更新适配器或在会话中热切换适配器版本。
- 宿主到远端的适配器二进制复制；远端自行安装或预装。
- 通用 OS 进程选择器；只提供 provider 声明的进程发现。
- 非 UTF-8 文件编辑和二进制文件编辑。
- 内存写入默认开启；必须显式配置并逐次审批。
- 反向调试/时间旅行作为独立产品能力；仅在适配器声明 `supportsStepBack` 等能力时暴露对应操作。

## 19. 文档与治理

- 新增 `docs/subsystems/debug.md` 和中文配对，记录能力缝类型、状态机、执行世界、权限和限制。
- 新增 `docs/user/guide/debugging.md` 和中文配对，面向 Web/Desktop/CLI 三端说明工作台、TUI、配置、适配器安装和常见失败。
- 新增 `docs/user/guide/debugging-cli.md` 和中文配对，记录 `dsh tui` 的会话与调试模式、命令、键位、`$EDITOR` 和 headless NDJSON。
- 更新 `docs/architecture.md`：核心包表、能力缝、第 43 行 shipped profile 列表加入 `tui`（该行是应用启动契约的一部分，中英文配对同步）、where new behavior goes 增加「Add a debug adapter」。
- 更新生成目录：`docs/tool-catalog.md`、`docs/config-catalog.md`、`docs/event-producer-consumer.md`、`docs/module-graph.md`、`docs/capability-seams.md`、`docs/cli-help.md`（加入 `tui`）。
- 新增 profile 的真实落地点是 `packages/util/official-bundles/src/bundles.ts` 的 `PROFILE_TEMPLATES`：bundle 侧字段是 `dsh.bundle.patch`，profile 侧是 `dsh.profile.bundles`。`apps/tui` 必须由 `scripts/verify-application-entrypoints` 显式归类且不带 `bin`；`dsh tui` 可用还要求把 bundle 列为 CLI 安装依赖，并重跑 `gen-cli-help` 与 `gen-official-bundle-catalog`。
- 新增 `apps/tui/README.md`、`packages/tui/README.md` 和 `packages/bundle/tui-app/README.md`；`packages/debug/` 与 `packages/tui/` 是新分组，每个分组和每个包都同步补齐 `.md`、`.zh.md`、`.i18n.yaml` 三件套，并更新 `packages/README.md` 分组表。
- 每个包提供英文 README 与中文配对，包含 Use/Understand/Model Experience/Known Limitations。
- `docs/superpowers/` 三份工作文档（设计、计划、交接）是任务工作产物，不进入网站文档树；首次提交它们的变更把该目录加入 `scripts/translation-pairing.manifest.json` 的 `excluded`，理由随提交说明记录。
- 决策记录先落 `.agents/notes/proposed/architecture/2026-10-25-debug-adapter-seam.md`，记录为什么选 DAP、托管适配器、执行世界映射、三端分工、停住唤醒和按会话控制授权边界；首批代码合入后按 `.agents/notes/README.md` 迁移到 `implemented/`，并把其中的计划语气改成现在时事实描述。两个位置都在双语语料内，都需要 `.zh.md` 与 `.i18n.yaml`。
- 新功能是增量能力，预计不需要升级指南；若实现中改变了已发布 Session 判别式或 `workspace-files` 契约，按仓库规则立即补升级指南并评审持久化类型。
- 第三方适配器加入 `THIRD_PARTY_NOTICES.md`；官方插件视觉使用现有 artwork 规范。
- 所有用户可见文案进入 locale 字典；英文 sentence case；不硬编码客户端文案。

## 20. 验收清单

- [ ] 四种语言在本机完成启动、断点、条件断点、单步、变量、求值、异常、重启、终止闭环。
- [ ] Web 工作台、Desktop 工作台、CLI TUI 三端都能完成同一调试闭环，归一化状态和错误码一致。
- [ ] `dsh headless --json` 输出有界 NDJSON 调试事件，CI 可消费；不绕过审批。
- [ ] 同一会话可由人工和 Agent 交替控制，状态一致，审计完整；Agent 控制人创建的会话在未授权时返回 `DEBUG_CONTROL_NOT_GRANTED`，开关与单次审批两条路径都有测试。
- [ ] 每个 launch/attach 都带发起 Session；归档该 Session 时运行中的调试会话被报告并逐个终止，不残留到 Host 关闭。
- [ ] Agent 在非自己发起的停住时收到有界唤醒通知，且可静默/关闭。
- [ ] 本机、SSH、沙箱分别至少一个 launch 闭环；SSH 至少一个 attach 闭环；不支持组合明确报错。
- [ ] 适配器托管安装、校验和验证、版本固定、覆盖路径、安装中断恢复和许可证展示可用。
- [ ] Web/Desktop 工作台包含文件树、多标签编辑器、断点槽、当前行、调用栈、变量、监视、断点、控制台、线程和适配器支持的高级面板。
- [ ] CLI TUI 包含会话记录、输入行、工具摘要、状态栏、调用栈、变量/监视、断点、控制台、源码预览、命令模式和 `$EDITOR` 跳转；对话进入同一 Session 日志。
- [ ] 编辑器保存使用版本冲突检测，外部变更和覆盖有明确 UI。
- [ ] 断点、监视、命名配置跨 Host 重启保留；调试会话不保留且状态明确。
- [ ] 所有模型可见事实可从 Session 日志重建；TS/Python SDK 预期输出同步。
- [ ] 安全测试覆盖审批、attach、沙箱拒绝、SSH 不回退、路径逃逸、环境变量脱敏、校验和失败和内存写入审批。
- [ ] 每文件 100% 覆盖率、真实组合测试、快照、浏览器 lane、TUI PTY、NDJSON、文档门禁和 i18n 检查全部通过。
- [ ] `docs/subsystems/debug.md`、三端用户指南、TUI/CLI 帮助、包 README、架构图和生成目录完成中英文配对。
- [ ] Agent Note、第三方声明和任何必要的升级指南已提交。

## 21. 评审裁决记录（2026-10-25）

评审以仓库第一手证据逐条核对了本文引用的 API 与落地点：`PROFILE_TEMPLATES` 与 `OPTIONAL_BUNDLES` 的字段与语义（`packages/util/official-bundles/src/bundles.ts`）、`ctx.terminals` 服务键（`packages/terminal/terminal/src/index.ts`）、shipped profile 清单（`docs/architecture.md` 应用启动节）、`verify-translation-pairing` 的 `docs/` 作用域（`scripts/translation-pairing.ts`）、DAP 规范生命周期（microsoft.github.io/debug-adapter-protocol/overview）以及本机工具链探测。裁决如下：

1. **组合归属**：模型侧与 UI 侧都走官方可选 bundle `@deepseek-ai/dsh-debug-bundle` 登记进 `OPTIONAL_BUNDLES`，v1 不进 `dsh-base`，不被任何 shipped template 默认选中；「Web/Desktop 默认启用」与「tui 进默认模板」是验收后的独立后续决策。依据：仓库「新能力先做成可选 bundle」的准入决定、`OPTIONAL_BUNDLES` 对 `dsh.bundle.patch`/`icon`/`./locale/*.json` 的结构要求真实存在、不为每个部署强加审批回答者缺位的 fail-closed 成本。
2. **契约冻结**：第 4 节与实现计划 Shared Interfaces 构成冻结契约，Task 1 原样落入 `packages/debug/debug/src/types.ts`，任何漂移先改契约再改实现。评审修正四处：`launch`/`attach` 均返回 `DebugSession`（删除 `DebugLaunchResult` 死 union）；`source` 参数品牌化为 `DebugSourceReference`；`pause` 补齐 `DebugOperationOptions`；状态事件集合定为七个（无 `adapter-ready`，与实现计划 Task 1 一致）。
3. **传输接口**：统一为实现计划的 `{ input: AsyncIterable<Uint8Array>, write(bytes), end() }`，废弃 `ReadableStream`/`WritableStream` 版本。
4. **TUI 依赖**：采纳 Ink + ink-testing-library（版本固定）；node-pty 仅作为 TUI 测试的 devDependency（驱动 raw 模式、尺寸变化、`NO_COLOR`），运行时零 PTY 依赖——TUI 渲染自身 stdout、适配器经 `ctx.subprocess` 管道启动、`runInTerminal` 复用 `ctx.terminals`。
5. **双语配对**：`docs/superpowers/` 是任务工作文档，不进网站文档树；首次提交它们的变更把该目录加入 `scripts/translation-pairing.manifest.json` 的 `excluded`。正式契约仍按第 19 节移交 `docs/subsystems/debug.md`、用户指南与 Agent Note。
6. **耐久事件修正**：`debug/session-ended` 的 `outcome` 为 `terminated | disconnected | failed`，与 4.2 状态机一致。
7. **协议一致性依据**：DAP `initialize` 参数（`linesStartAt1`/`columnsStartAt1`/`pathFormat`）与「未声明能力不必显式返回 false、按缺失处理」的语义已对照官方规范确认；第 5.5 节能力映射默认 false 与规范一致。
8. **环境约束记录**（写入交接文档与实现计划，不是本设计的部署事实）：评审用开发机为 macOS arm64，node 24 与 python 3.12、rustc/clang 工具链在场，go/dlv/lldb-dap/debugpy 缺失；真实适配器矩阵在该机器上对 Go 与 Native 显式 skip 并记录原因，全平台矩阵由 CI 拥有。
