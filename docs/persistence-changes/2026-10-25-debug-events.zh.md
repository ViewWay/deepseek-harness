---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-25-debug-events

[English](2026-10-25-debug-events.md) | 中文

## 概述

为 IDE 调试 seam 新增四个耐久 debug 会话事件与 debug 消息来源 kind。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-25-debug-events
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-22-action-card-status"
    after: "a3350939382f67282d02e4eb5889f901a4c241c74a09f684ec97d85bef58905e"
    decision: same-version
  - root: "event:debug/control"
    previous: null
    after: "fc0d65adc7f4f4593612dd19a71f437d4b00c42fc0ef683f6416c502bf76a22a"
    decision: same-version
  - root: "event:debug/session-ended"
    previous: null
    after: "de74de3374c208db12db696928513b6bec3280b454af4c9daa06ffd646dcca13"
    decision: same-version
  - root: "event:debug/session-started"
    previous: null
    after: "3f0bf9c6d2e3320871de12e6809b97c2c67ae7b05d30a8148b98f06a51e7b42f"
    decision: same-version
  - root: "event:debug/stopped"
    previous: null
    after: "81dc553a3b2ad99c040474e9eeb83fe03297611364bdf8581da2752a3378c8f2"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-22-action-card-status"
    after: "1fcefe1b43f9e0aa6dcfaf61a88c2009e58d1c3ffac83f25859b16cfd4c14451"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-22-action-card-status"
    after: "9406473403fa4faa49dc99d33448f004a5717d5289c465eedf7c151571f23ac1"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-22-action-card-status"
    after: "569d24c685fad7021c2861692baadf9778c468f32a2e9669ba653cdaa58ba3aa"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两个方向均保持 same-version。四个 debug/* 事件是 append-only 的 Session 事件，写入方将每个信封标记为 ignorable: true，不认识判别符的读取方本就容忍它们，既有回合的回放不变。debug kind 扩展的是可合并扩展的 MessageSourceMap 联合；既有写入方从不发出它，既有读取方按文档化的 merge-extensible default 切换来源 kind，新增备选不可能改变它们解读缺少该备选记录的方式。agent/inbox/spliced、developer/message、user/message 与 session/title-llm-request 共享 Message 与 MessageSource 类型，因此其摘要移动而自身行为不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/debug/debug packages/debug/tool-debug packages/test-support/debug-e2e：通过。本记录落盘后 pnpm run verify-persistence-changes：通过。

<a id="dev-note"></a>
## 开发备注

无。
