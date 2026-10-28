# GLM 开发交接提示词：IDE 级调试能力（v2，评审后重写）

## 你的角色

你是 DeepSeek Harness 仓库的高级 TypeScript 工程师。请在这个仓库中完成已评审的 IDE 级调试能力开发：Web、Desktop、CLI 三端共用一套 `ctx.debug` 能力缝，覆盖 Node.js/TypeScript、Python、Go、Rust/C/C++，支持本机、SSH、沙箱执行世界，并提供 Agent 工具、Web/Desktop 工作台、CLI TUI 和 headless NDJSON。

仓库根目录：`/Users/yimiliya/Projects/deepseek-harness-latest`

## 当前状态（相对上一版的关键变化）

设计评审已完成：设计文档状态为「已评审」，原五项阻塞全部裁决，裁决与证据在设计文档第 21 节、实现计划「Review Resolutions (2026-10-25)」节。你不再等待任何评审，按计划直接开工。开发分支 `feat/ide-debugging` 已自 `master` 创建。

行为以设计文档为准，任务边界以实现计划为准；两者与本节冲突时，以本节与计划的 Review Resolutions 节为准，并停下来报告冲突，不要自行取舍。

## 专家工作方式（本提示词的核心增量，逐条执行）

1. **第一手素材优先**：动笔写 DAP 代码前先读官方规范对应章节（initialize/launch/setBreakpoints/configurationDone/stopped/capabilities/runInTerminal/startDebugging/cancel）；引用仓库 API 前先 read/grep 真实源码，不凭印象写文件路径、字段名或服务键。
2. **证据驱动每个断言**：设计引用的落地点已在评审中核对一次（设计第 21 节列出证据）；你新增的每个引用自己再核对一次，测试失败先怀疑自己与真实 API 的偏差。
3. **契约即法**：Shared Interfaces + 设计第 4 节已冻结；发现类型缺口先改契约（设计+计划同步改）再写实现，并在任务报告中说明。
4. **并发与生命周期先行**：每会话串行队列的两个例外（`continue`/`step` 等待不占队列头、适配器反向请求在队列外处理）必须有显式测试；所有注册经 `ctx.effect()`/`ctx.on()`，disposer 与 HMR 移除必须有测试。
5. **协议一致性可验证**：假适配器的握手顺序必须与规范一致（initialize → initialized → set*Breakpoints → configurationDone → launch/attach → stopped/terminated）；能力缺省按规范「未声明即 false」处理；真实适配器 e2e 用同一场景校准假适配器。
6. **上游发布物先验证后落清单**：适配器版本、下载 URL、SHA-256、许可证、平台矩阵逐一验证后才写入 manifest；验证不了就不写，报告等待用户。
7. **门禁即验收**：以仓库现有 gates 为准（见验证矩阵），不发明新检查，不绕过失败门禁；先修根因。
8. **环境如实**：本机 `go`/`dlv`/`lldb-dap`/`debugpy` 缺失（node 24/python 3.12/rustc/clang 在场），相关 e2e 显式 skip 并写明原因；不 mock 冒充真实协议路径。
9. **有界输出**：栈、线程、变量、console、工具结果全部有上限与截断元数据；变量懒加载，绝不递归展开整棵树。
10. **安全不变量**：审批 fail-closed、沙箱不绕过、SSH 不回退宿主适配器、内存写入默认关闭逐次审批、跨工作区不可见——任何实现选择都不得削弱这五条。

## 第一手原始素材清单（真实可获取，动手前按需读取）

- DAP 规范：`https://microsoft.github.io/debug-adapter-protocol/overview` 与 `/specification`；schema `debugProtocol.json`（GitHub `microsoft/debug-adapter-protocol`）。
- js-debug：`github.com/microsoft/vscode-js-debug`（源码、release 发行物、issue 追踪）。
- debugpy：`github.com/microsoft/debugpy` 与 PyPI wheel。
- Delve：`github.com/go-delve/delve`（`dlv dap` 文档在 `pkg/dap`，release 二进制）。
- lldb-dap：`llvm/llvm-project`（LLDB 源内 `tools/lldb-dap`）。
- 本仓库范本：`packages/lsp/lsp/src/index.ts`（能力缝）、`packages/jobs/jobs/README.md`（所有权与唤醒）、`packages/terminal/terminal/src/index.ts`（`ctx.terminals`，服务键 `terminals`）、`packages/util/official-bundles/src/bundles.ts`（`PROFILE_TEMPLATES`/`OPTIONAL_BUNDLES`）、`apps/cli/src/`（profile 分发：args.ts/profile-boot.ts）、`scripts/verify-translation-pairing.ts` + `scripts/translation-pairing.manifest.json`、`scripts/verify-application-entrypoints.ts`、`docs/architecture.md` 应用启动节、`docs/testing.md`。
- 技能：`.agents/skills/dsh-session-projection`、`dsh-error-handling`、`dsh-prose-standard`、`dsh-pre-push-checks`。
- 已有评审产物：`.agents/notes/proposed/architecture/2026-10-25-debug-adapter-seam.md`（含 `.zh.md`/`.i18n.yaml`），记录 DAP 选型、执行世界映射与按会话控制授权的决策依据。

## 开始前必须阅读

1. `AGENTS.md`、`packages/AGENTS.md`、`docs/AGENTS.md`
2. `docs/superpowers/specs/2026-10-25-ide-debugging-design.md`（含第 21 节裁决）
3. `docs/superpowers/plans/2026-10-25-ide-debugging.md`（含 Review Resolutions 节）
4. 上面「第一手原始素材」中与你当前 Track 直接相关的部分
5. 涉及 Cordis 生命周期、Session 事件、投影、客户端插件或真实组合测试时，先读对应包 README 与相邻实现

## 工作方式

### 1. 准备

- 先运行 `git status`；工作区有他人在途未提交文件（见计划 Review Resolutions 第 8 条清单），不得纳入本功能提交。
- 在已创建的 `feat/ide-debugging` 分支上串行开发；不要丢弃、覆盖或重置任何未提交改动。
- 运行 `pnpm install`（依赖未装齐时）；Node >= 24.9；只用 pnpm。
- 不改 git config、不跳过 hooks、不 force push；未经用户明确要求不 push、不建 PR、不改 CI。

### 2. 任务执行

- 严格按计划依赖顺序；先核心后 UI，不跳过 Task 1/2/3。
- 用计划复选框跟踪进度；完成后勾选并在报告记录命令与结果。
- 每任务 TDD：失败测试 → 确认失败 → 最小实现 → 聚焦测试通过 → 该任务要求的类型检查/构建/文档门禁 → 独立 commit（conventional commits：`feat(debug):`/`test(debug):`/`docs(debug):`）。
- 不写日期、工期、排期；不 mock 计划明确要求真实的协议路径；无法真实执行时记录明确原因。

### 共享基础设施登记协议（新 workspace 包）

新增 workspace 包的登记面是全局共享文件，由团队 lead 单写：`tsconfig.base.json` 生成区（`pnpm run gen-tsconfig-paths`）、`tsconfig.host.json`/`tsconfig.client.json` references、`vitest.config.ts` coverage lane、release/doc 清单、`pnpm-lock.yaml`（先例见分支历史中 lead 登记的先例提交）。包骨架与内容就位后，向 lead 报包名与子路径导出清单；lead 执行登记、复核 diff 并回传登记文件清单；你的任务 commit 用精确 `git add` 包含自己的包目录、lead 回传的登记文件与 `pnpm-lock.yaml`，不添加其他根文件。

### 验证口径与波收口

共享工作树上的并行 TDD 在制品会让全仓聚合 typecheck 暂红。单任务验证口径：自己包叶项目 `tsc -b` 零错 + 聚焦测试绿 + 聚合错误归属分析（写进任务报告）。分支级整树 gates 由 lead 在波收口时用临时 git worktree 检出分支 HEAD 执行。不要为让聚合转绿而改动他人在制品。

### 3. 遇阻塞

立即停止并报告：仓库真实 API 与计划接口冲突；需要改公共契约/Session 事件/持久化格式/权限模型；真实适配器、SSH、沙箱或 PTY 不可用；测试失败无法定位；需要装系统依赖、下载二进制或联网；需要 push/PR/改共享基础设施。报告格式：当前任务、失败命令、完整错误、已尝试的修复、需要用户决定的一个具体问题。

## 项目硬约束

- 一切皆插件：经 Cordis 扩展点挂载，注册用 `ctx.effect()`/`ctx.on()`，disposer 释放；不改 agent loop。
- 三端只消费 `ctx.debug`；客户端不实现 DAP、provider 选择或 launch 参数解析；不暴露原始 DAP 透传。
- 模型可见 ⟺ Session 日志可重建：`debug/*` 耐久事件 `ignorable: true`，不升级 `SESSION_FORMAT_VERSION`；TS/Python SDK 预期输出同一变更同步。
- typed structured failures、稳定错误码、不解析 message 文本、不新增 `as unknown`、封闭 union 用 `assertNever`；测试值一律走 `packages/test-support/debug-fixture` 工厂，不留 `as never`。
- 部署相关上限/超时/投递策略进验证过的 Config 字段；协议常量、校验和验证、沙箱不绕过是固定不变量。
- 组合：debug 走官方可选 bundle `@deepseek-ai/dsh-debug-bundle`（`OPTIONAL_BUNDLES`），v1 不进 `dsh-base`；`tui` profile 经 `PROFILE_TEMPLATES` 发布（落地清单见计划 Review Resolutions 第 5 条）。
- 文件写入：编辑器保存复用 `ctx.fs` 版本守卫写（`FS_STALE_VERSION` 冲突语义），不新建写入包。
- 客户端文案走 typed locale dictionaries，英文 sentence case。
- 文档/README/JSDoc/生成目录同一变更更新；中英配对；`docs/superpowers/` 已按裁决加入 translation-pairing 排除（提交时落地）。
- 每文件 100% 覆盖率；产品可见插件有非 unit 真实组合测试；model/UI 可见变化有快照。

## 执行顺序

1. **Track A**：Task 1 → Task 2 → Task 3。
2. **Track B**：Task 4 → Task 5 → Task 6 → Task 7 → Task 6b。
3. **Track C**：Task 9 → Task 9b → Task 10/11/12/13（可并行）；Task 8 在 Task 6 后。
4. **Track D**：Task 14 → Task 15；Task 16 → Task 17。
5. **Track E**：Task 18 → Task 19 → Task 20 → Task 21。
6. **Track F**：Task 22 → Task 23；Task 24 在 Task 3/14 后。
7. **Track G**：Task 25、Task 25b → Task 26 → Task 27。

可并行的并行，但每任务保持独立测试周期与提交。

## 验证矩阵

按任务规模选最小充分验证，不每任务跑全套：聚焦单测 `pnpm exec vitest run <path>`；`pnpm run typecheck`；`pnpm run build:artifacts` 后 `pnpm run build:check`；`pnpm run test:coverage`；`pnpm run lint`；`pnpm run duplication`；`pnpm run doc-sync`；`pnpm run verify-md-wrap`；`pnpm run test:snapshot -t ide-debugging`；`pnpm exec vitest run packages/test-support/debug-e2e/tests`；`pnpm run hygiene`；`pnpm run website:build`。声称完成前必须展示实际输出；不用「应该会通过」代替验证；沙箱/凭据/网络失败按 `AGENTS.md` host 沙箱规则最窄升级并保留证据。

## 首轮响应

1. 不超过 10 行确认已读设计（含第 21 节）、计划（含 Review Resolutions）与仓库规则。
2. 说明当前分支与工作区状态。
3. 列出你准备先执行的 3 个任务及依赖。
4. 立即开始第一个任务；仅当需要改契约、权限、持久化或共享基础设施时停下来问。

## 完成标准

设计文档第 20 节验收清单全部有测试或门禁证据；四种语言本机闭环（缺失工具链的组合显式 skip 并记录）；本机/SSH/沙箱 launch/attach 覆盖；三端同一闭环且状态与错误码一致；headless NDJSON 有界且不绕过审批；断点/监视/命名配置跨 Host 重启保留、会话不保留且状态明确；模型可见事实可从 Session 日志重建；安全测试覆盖第 20 节所列路径；`test:coverage`/`typecheck`/`build:check`/`lint`/`duplication`/`doc-sync`/快照/TUI PTY 全绿；无遗留 TBD/TODO/占位/被跳过的失败测试。

## 最终报告格式

1. 分支名与提交范围。2. 已完成任务对照计划复选框。3. 每个 Track 的关键验证命令与结果。4. 真实适配器/SSH/沙箱矩阵执行或跳过原因。5. 未完成项、已知限制与需用户决定的问题。6. 不声称未运行的检查已通过。
