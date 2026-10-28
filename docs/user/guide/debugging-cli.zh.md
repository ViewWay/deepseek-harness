# 终端调试：TUI 与 headless

[English](debugging-cli.md) | 中文

## 概述

`tui` profile 在终端内调试：同一 agent 会话之上的聊天、分屏与调试三种布局，冒号前缀的调试命令与功能键，`$EDITOR` 源码预览，无浏览器。headless profile 在 `--json` 事件流中向脚本与 CI 报告调试事实。两个端与 Web/Desktop 工作台消费同一个 `ctx.debug` 缝。

## 目录

- [启动 TUI](#start-the-tui)
- [调试布局](#debug-layout)
- [命令与按键](#commands-and-keys)
- [源码预览与 $EDITOR](#editor-handoff)
- [调试 headless 运行](#headless-ndjson)
- [CI 适配器准备](#ci-adapters)
- [延伸阅读](#further-exploration)

<a id="start-the-tui"></a>
## 启动 TUI

```sh
dsh --profile tui
```

TUI 以聊天布局打开。普通文本即提示词；前导 `:` 执行命令（`:help` 查看列表）。调试面板在调试布局（`:debug`）中，分屏布局（`:split`）把会话记录与面板并排显示。TUI 与 agent 会话同进程运行——无浏览器、无 Remote 层、无额外端口。

调试面板只在 profile 中启用了调试 bundle 时出现。启动 TUI 前先经 `dsh plugin` 开启；没有能力缝时 `:debug` 布局显示占位提示。

<a id="debug-layout"></a>
## 调试布局

`:debug` 切到调试布局，`:chat` 返回。面板直接折叠实时的 `ctx.debug` 事件流——与 Web 工作台、NDJSON 流看到的相同事件——成为有界的 console、栈、断点与帧行。输出上限保证长时间运行下面板可用；更早的 console 行滚动移出而不是无限增长。

<a id="commands-and-keys"></a>
## 命令与按键

冒号命令驱动会话：`:pause`、`:continue`、`:next`、`:step`、`:out`、`:break`（带 `file:line` 参数），以及经 `:adapter` 的适配器列举与安装。功能键映射到同一组命令：F5 继续，Shift+F5 暂停，F9 切换断点，F10 单步跳过，F11 单步进入，Shift+F11 单步跳出。

过长的工具输出在会话记录中以摘要显示并带 `(:expand n)` 标记；`:expand <n>` 就地展开存储的完整输出，展开后标记消失。

在服务级 launch 面启用之前，终端里的 launch 与 attach 会报告调试服务自身的提示；面板中出现类型化提示而不是静默失败。需要审批的操作经 TUI 的审批回答器询问——没有回答者就没有 launch。

<a id="editor-handoff"></a>
## 源码预览与 $EDITOR

停住选中帧时，面板显示停住行附近有界范围内的源码预览。`open-editor`（或面板的编辑器动作）把当前文件与行以 argv 交给 `$EDITOR`——`+<line> file`，中间没有 shell。启动 TUI 前设置好 `$EDITOR`；未设置或不可用的编辑器会报告失败而不是什么都不打开。

<a id="headless-ndjson"></a>
## 调试 headless 运行

```sh
dsh --profile headless --json "run the test suite" > run.jsonl
```

`--json` 把运行投影为 stdout 上的换行分隔 JSON 事件流。调试事实走所有端写入的同一批耐久 `debug/*` 会话事件：会话启动、停住、结束与控制决策，每个都带 `ignorable`，下游解析器可以跳过。流保持有界——除终止 `final` 外每个字符串上限 8 KiB 并带 `truncated` 标记——调试密集的运行不会灌满 CI 日志。流是投影不是日志；投影未建模的内容不会出现。

在 headless profile 中启用调试 bundle 后 Agent 获得调试工具，NDJSON 流报告工具做了什么。部署仍须提供审批回答者；没有回答者的 headless 运行在 launch 与 attach 上按 fail-closed 拒绝。

<a id="ci-adapters"></a>
## CI 适配器准备

适配器首次使用时才安装，这不希望发生在正式 CI 运行中。在 setup 阶段预热缓存：每个语言跑一次一次性 launch（或经适配器管理器跑自检），让下载与校验和验证发生在计时运行之前。离线 runner 应通过 provider 覆盖提供适配器命令——镜像内解析的固定适配器版本——而不是运行时下载。

<a id="further-exploration"></a>
## 延伸阅读

- [调试子系统契约](../../subsystems/debug.zh.md)
- [Web/Desktop 工作台调试](./debugging.zh.md)
- [headless profile](../../../packages/bundle/headless/README.zh.md)
