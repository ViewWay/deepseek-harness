---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-25-debug-events

English | [中文](2026-10-25-debug-events.zh.md)

## Summary

Adds the four durable debug session events and the debug message source kind for the IDE debugging seam.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Both directions stay same-version. The four debug/* events are append-only Session events whose writers mark every envelope ignorable: true, so readers that do not know the discriminators already tolerate them and replay of existing turns is unchanged. The debug kind extends the merge-extensible MessageSourceMap union; existing writers never emit it, and existing readers switch on source kind through the documented merge-extensible default, so an added alternative cannot change how they interpret records that lack it. agent/inbox/spliced, developer/message, user/message, and session/title-llm-request share the Message and MessageSource types, which is why their digests moved without any behavior change of their own.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/debug/debug packages/debug/tool-debug packages/test-support/debug-e2e: passed. pnpm run verify-persistence-changes: passed after this record.

<a id="dev-note"></a>
## Dev Note

None.
