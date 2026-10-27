/**
 * The TUI's Ink interactive app: renders the transcript, reads input through
 * Ink's single input loop, and dispatches prompts and commands. Implements the
 * Chat/Split/Debug layouts from the design (F6 and F7 switch), renders the
 * pending approval question, confirms exit while debug sessions run, and
 * persists layout and command history through the client state. Exits on
 * Ctrl+C or `:q`.
 * @module @deepseek-ai/dsh-tui/app
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, render, useInput, useStdin } from 'ink'
import { parseTuiInput } from './input.ts'
import { functionKeyOf, parseTuiKey } from './keys.ts'
import type { TuiApprovalQueue, TuiApprovalRequest } from './approval.ts'
import { createTuiClientState } from './state.ts'
import type { TuiLayout } from './state.ts'
import type { TuiTranscript, TuiTranscriptEntry } from './transcript.ts'

/** The transcript face the app renders; the runner owns the real store. */
export interface TuiTranscriptSource {
  /** The transcript as of now. */
  current(): TuiTranscript
  /** Notify on transcript changes; returns the unsubscribe function. */
  subscribe(callback: (transcript: TuiTranscript) => void): () => void
}

/**
 * The optional debug pane service this app renders, declared structurally:
 * the composition supplies the `tuiDebugPane` value built by
 * `@deepseek-ai/dsh-tui-debug`, whose full face matches this subset.
 */
export interface TuiDebugPaneView {
  /**
   * The rendered pane lines as of now.
   * @returns the plain-text lines in display order.
   */
  current(): readonly string[]
  /**
   * Subscribe to pane-line changes.
   * @param listener - the listener receiving the next lines.
   * @returns the disposer; after it runs the listener sees nothing further.
   */
  subscribe(listener: (lines: readonly string[]) => void): () => void
  /**
   * Run one raw `:` input line against the debug seam.
   * @param line - the raw line, with or without the leading colon.
   * @returns false when the line is not a debug command.
   */
  run(line: string): boolean
  /**
   * Run one debug function key as its mapped command.
   * @param key - the decoded function-key name.
   * @returns false when the key has no debug mapping.
   */
  runKey(key: string): boolean
  /** Open the current source location in the configured editor. */
  openEditor(): void
}

/** Props for the TUI app component. */
export interface TuiAppProps {
  /** Submit one prompt through the session's send path. */
  readonly onPrompt: (text: string) => Promise<void>
  /** Dispatch one non-builtin `:` command; builtins (`:q`, layouts) stay in the app. */
  readonly onCommand: (name: string, args: readonly string[]) => void
  /** Leave the app; called only after any running-session confirmation. */
  readonly onExit: () => void
  /** The transcript store the app renders. */
  readonly transcriptSource: TuiTranscriptSource
  /** The approval queue the terminal answerer feeds; absent disables approval keys. */
  readonly approvals?: TuiApprovalQueue
  /** Ids of running debug sessions; a non-empty list gates exit behind a confirm. */
  readonly runningDebugSessions?: () => readonly string[]
  /** The debug pane; until `dsh-tui-debug` lands a placeholder renders instead. */
  readonly debugPane?: React.ReactNode
  /**
   * The composed `tuiDebugPane` service; when present its live pane replaces
   * the placeholder, and input lines, function keys, and `o` route into it.
   */
  readonly debugPaneSource?: TuiDebugPaneView
  /** Layout restored from the persisted client state (default Chat). */
  readonly initialLayout?: TuiLayout
  /** Status-line label; the runner supplies session and model facts. */
  readonly statusLabel?: string
}

/** Where key focus sits when a debug pane is present. */
type TuiFocus = 'input' | 'debug'

/** The key facts Ink's `useInput` reports; exactly the fields {@link parseTuiKey} reads. */
interface TuiInkKey {
  readonly return: boolean
  readonly backspace: boolean
  readonly delete: boolean
  readonly tab: boolean
  readonly escape: boolean
  readonly ctrl: boolean
}

/** One rendered transcript line. */
function TranscriptLine(
  { entry, stored }: { entry: TuiTranscriptEntry; stored: ReadonlyMap<number, string> },
): React.ReactElement {
  if (entry.kind === 'user') return <Text color="cyan">&gt; {entry.text}</Text>
  if (entry.kind === 'assistant') return <Text color="green">{entry.text}</Text>
  if (entry.expanded === true && entry.expandId !== undefined) {
    const fullText = stored.get(entry.expandId)
    if (fullText !== undefined) return <Text color="yellow">[{entry.name}] {fullText}</Text>
  }
  const hint = entry.expandId === undefined || entry.expanded === true ? '' : ` (:expand ${entry.expandId})`
  return <Text color="yellow" dimColor>[{entry.name}] {entry.summary}{hint}</Text>
}

/** The transcript column shared by the Chat and Split layouts. */
function TranscriptColumn({ transcript }: { transcript: TuiTranscript }): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {transcript.entries.map((entry, index) => (
        <TranscriptLine key={index} entry={entry} stored={transcript.stored} />
      ))}
    </Box>
  )
}

/** The placeholder shown for the debug pane until `dsh-tui-debug` mounts. */
function DebugPlaceholder(): React.ReactElement {
  return (
    <Box flexDirection="column" margin={1}>
      <Text dimColor>debug panels arrive with @deepseek-ai/dsh-tui-debug</Text>
      <Text dimColor>:chat returns to the conversation</Text>
    </Box>
  )
}

/** The debug pane rendered from the composed `tuiDebugPane` service lines. */
function DebugPaneView({ source }: { source: TuiDebugPaneView }): React.ReactElement {
  const [lines, setLines] = useState<readonly string[]>(() => source.current())
  useEffect(() => {
    // Subscribe first, then re-sync: events landing between the initial
    // snapshot and this commit become visible immediately.
    const dispose = source.subscribe(setLines)
    setLines(source.current())
    return dispose
  }, [source])
  return (
    <Box flexDirection="column" margin={1}>
      {lines.map((line, index) => (
        <Text key={index}>{line}</Text>
      ))}
    </Box>
  )
}

/**
 * Resolve the pane node to render: an explicit node wins, then the composed
 * service's live view, then the placeholder.
 * @param props - the app props carrying either pane form.
 * @returns the pane node for the debug and split layouts.
 */
function debugPaneOf(props: Pick<TuiAppProps, 'debugPane' | 'debugPaneSource'>): React.ReactNode {
  if (props.debugPane !== undefined) return props.debugPane
  if (props.debugPaneSource === undefined) return <DebugPlaceholder />
  try {
    props.debugPaneSource.current()
    return <DebugPaneView source={props.debugPaneSource} />
  } catch (error) {
    // A pane service that cannot answer must not take the terminal down;
    // the placeholder keeps the layout usable.
    void error
    return <DebugPlaceholder />
  }
}

/** The TUI app component. */
export function TuiApp(props: TuiAppProps): React.ReactElement {
  const [transcript, setTranscript] = useState<TuiTranscript>(() => props.transcriptSource.current())
  const [layout, setLayout] = useState<TuiLayout>(() => props.initialLayout ?? 'chat')
  const [input, setInput] = useState('')
  // React batches state updates, but queued stdin chunks in one tick must read
  // the input as of the previous key; the ref is the source of truth.
  const inputRef = useRef('')
  const [focus, setFocus] = useState<TuiFocus>('input')
  const [exitConfirm, setExitConfirm] = useState<readonly string[] | undefined>(undefined)
  const [approvalPending, setApprovalPending] = useState<TuiApprovalRequest | undefined>(() => props.approvals?.pending())
  const clientState = useRef(createTuiClientState())
  // The raw stdin listener outlives renders; the refs carry the focus and
  // props it must read at event time.
  const focusRef = useRef<TuiFocus>('input')
  focusRef.current = focus
  const propsRef = useRef(props)
  propsRef.current = props

  const applyLayout = useCallback((next: TuiLayout): void => {
    clientState.current.setLayout(next)
    setLayout(next)
  }, [])

  useEffect(() => props.transcriptSource.subscribe(setTranscript), [props.transcriptSource])
  useEffect(() => {
    if (props.approvals === undefined) return
    setApprovalPending(props.approvals.pending())
    return props.approvals.subscribe(setApprovalPending)
  }, [props.approvals])

  // Ink parses function keys internally but reports them with an empty input
  // and no public flag, so the layouts listen for the raw sequences here; Ink
  // itself no-ops on them, so nothing is handled twice.
  const { stdin } = useStdin()
  useEffect(() => {
    if (stdin === undefined) return
    const onData = (chunk: string): void => {
      const key = functionKeyOf(chunk)
      if (key === undefined) return
      if (key === 'f6') applyLayout('debug')
      else if (key === 'f7') applyLayout('split')
      else if (focusRef.current === 'debug') propsRef.current.debugPaneSource?.runKey(key)
    }
    stdin.on('data', onData)
    return () => { stdin.off('data', onData) }
  }, [stdin, applyLayout])

  const requestExit = useCallback((): void => {
    const running = props.runningDebugSessions?.() ?? []
    if (running.length === 0) {
      props.onExit()
      return
    }
    setExitConfirm(running)
  }, [props])

  const submitLine = useCallback((line: string): void => {
    if (line.trim() === '') return
    const parsed = parseTuiInput(line)
    if (parsed.kind === 'prompt') {
      void props.onPrompt(parsed.text).catch(() => {})
      return
    }
    clientState.current.pushCommand(line)
    if (parsed.name === 'q' || parsed.name === 'quit' || parsed.name === 'exit') {
      requestExit()
      return
    }
    if (parsed.name === 'chat' || parsed.name === 'split' || parsed.name === 'debug') {
      applyLayout(parsed.name as TuiLayout)
      return
    }
    props.onCommand(parsed.name, parsed.args)
  }, [props, requestExit, applyLayout])

  const handleKey = useCallback((rawInput: string, key: TuiInkKey): void => {
    if (approvalPending !== undefined && props.approvals !== undefined) {
      if (parseTuiKey(rawInput, key).kind === 'ctrl-c') {
        props.approvals.answer('cancelled')
        return
      }
      if (rawInput === 'y') {
        props.approvals.answer('allowed-once')
        return
      }
      if (rawInput === 'n') {
        props.approvals.answer('rejected')
        return
      }
      return
    }
    if (exitConfirm !== undefined) {
      if (parseTuiKey(rawInput, key).kind === 'ctrl-c' || rawInput === 'y') {
        props.onExit()
        return
      }
      if (rawInput === 'n' || key.escape) {
        setExitConfirm(undefined)
        return
      }
      return
    }
    // In debug focus, `o` opens the current source location instead of typing.
    if (focusRef.current === 'debug' && rawInput === 'o') {
      props.debugPaneSource?.openEditor()
      return
    }
    const decoded = parseTuiKey(rawInput, key)
    switch (decoded.kind) {
      case 'ctrl-c':
        requestExit()
        return
      case 'tab':
        if (props.debugPane !== undefined || props.debugPaneSource !== undefined) {
          setFocus(previous => previous === 'input' ? 'debug' : 'input')
        }
        return
      case 'return': {
        const line = inputRef.current
        inputRef.current = ''
        setInput('')
        submitLine(line)
        return
      }
      case 'backspace':
      case 'delete':
        inputRef.current = inputRef.current.slice(0, -1)
        setInput(inputRef.current)
        return
      case 'print':
        inputRef.current += decoded.text
        setInput(inputRef.current)
        return
      default:
        return
    }
  }, [approvalPending, exitConfirm, props, requestExit, submitLine])
  useInput(handleKey)

  const debugPane = debugPaneOf(props)
  const body = layout === 'debug'
    ? debugPane
    : layout === 'split'
      ? (
        <Box flexDirection="row">
          <Box flexDirection="column" flexGrow={1} ><TranscriptColumn transcript={transcript} /></Box>
          <Box flexDirection="column" borderStyle="round" borderDimColor>{debugPane}</Box>
        </Box>
      )
      : <TranscriptColumn transcript={transcript} />

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {props.statusLabel ?? 'dsh tui'} · {layout}
        {(props.debugPane !== undefined || props.debugPaneSource !== undefined) && focus === 'debug'
          ? ' · focus: debug (Tab)'
          : ''}
      </Text>
      <Box flexDirection="column" flexGrow={1}>{body}</Box>
      <Text dimColor>─{'─'.repeat(38)}─</Text>
      {approvalPending !== undefined
        ? <Text color="yellow">approve {approvalPending.toolName}? {approvalPending.reason ?? ''} [y/n]</Text>
        : null}
      {exitConfirm !== undefined
        ? <Text color="yellow">running debug sessions: {exitConfirm.join(', ')} — quit anyway? [y/n]</Text>
        : null}
      <Box>
        <Text color="cyan">input &gt; </Text>
        <Text>{input}</Text>
      </Box>
      <Text dimColor>prompt or :command (:q to quit · F6 debug · F7 split)</Text>
    </Box>
  )
}

/**
 * Render the TUI app and return its unmount handle.
 * @param props - the app's callbacks and stores.
 * @returns the Ink render handle.
 */
export function renderTuiApp(props: TuiAppProps): ReturnType<typeof render> {
  return render(<TuiApp {...props} />, { exitOnCtrlC: false })
}
