/**
 * The TUI runner: mounts the Ink interactive loop as the consumer of the
 * startup service. It drives one interactive Agent over the same create/resume
 * and followup path headless uses, folds Session events into the transcript,
 * wires the terminal approval answerer, and confirms exit while debug sessions
 * run. Boot-time gaps (missing services, unknown resume id) fail loud before
 * the loop renders; send-time failures surface as transcript notices.
 * @module @deepseek-ai/dsh-tui/run
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-debug'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { createTuiApprovalQueue, installTuiApproval } from './approval.ts'
import { renderTuiApp } from './app.tsx'
import { createTuiTranscriptFeed } from './feed.ts'
import { createTuiSession } from './session.ts'
import { TUI_STARTUP_SERVICE } from './startup.ts'
import type { TuiSession } from './session.ts'

/** The built-in help the `:help` command renders. */
const HELP_LINES: readonly string[] = [
  ':chat · :split · :debug   switch layout (F6 debug, F7 split)',
  ':q                         quit (confirms while debug sessions run)',
  'debug commands land with @deepseek-ai/dsh-tui-debug',
]

/**
 * One readable line for any thrown value.
 * @param error - the thrown value.
 * @returns the message line.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Mount the TUI interactive loop.
 * @param ctx - plugin context carrying the startup values and core services.
 * @returns a promise that resolves once the loop is mounted.
 */
export function mountTuiApp(ctx: Context): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async (): Promise<void> => {
      const exit = ctx.get('appExit')
      if (exit === undefined) {
        throw new Error('tui: the launcher must provide ctx.appExit before the tree mounts')
      }
      // Loader siblings mount concurrently; only create the Agent once the
      // complete application is composed.
      await ctx.get('loader')?.await()
      const startup = ctx.get(TUI_STARTUP_SERVICE)
      if (startup === undefined) {
        resolve()
        return
      }
      const agents = ctx.get('agents')
      const sessions = ctx.get('sessions')
      const defaultModel = ctx.get('agentDefaultModel')
      if (agents === undefined || sessions === undefined || defaultModel === undefined) {
        throw new Error('tui: the profile must compose the dsh-base agents, sessions, and agentDefaultModel services')
      }
      const requestedId = startup.sessionId
      const sessionId = brandString<SessionId>(requestedId ?? `session-${randomUUID()}`)
      if (requestedId !== undefined) {
        // Resuming promises a later process can continue; without a durable log
        // the history would die with this one, so the mismatch fails loud here.
        if (ctx.get('sessionPersistence') === undefined) {
          throw new Error('tui --session-id requires the sessionPersistence service; the Session would not survive this process')
        }
        const query = ctx.get('sessionQuery')
        if (query === undefined) {
          throw new Error('tui --session-id requires the sessionQuery service; dsh-base provides it')
        }
        try {
          using observation = await query.observeSession(sessionId)
          void observation
        } catch (error: unknown) {
          if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
            throw new Error(`session "${sessionId}" does not exist; omit --session-id to start a new Session`)
          }
          throw error
        }
      }
      const fs = ctx.get('fs')
      const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))

      let agent: Agent | undefined
      let failureNotice: string | undefined
      let modelLabel = 'no model selected'
      try {
        const selection = defaultModel.currentSelection()
        const agentOptions = { ...selection }
        modelLabel = `${selection.provider}/${selection.model}`
        agent = requestedId === undefined
          ? (await agents.create({ sessionId, meta: { cwd }, agentOptions })).agent
          : (await agents.resume({ resumeSessionId: sessionId, agentOptions })).agent
      } catch (error: unknown) {
        failureNotice = messageOf(error)
      }

      const feed = createTuiTranscriptFeed()
      const approvals = createTuiApprovalQueue()
      installTuiApproval(ctx, approvals)
      let notice: (text: string) => void = () => {}
      const session: TuiSession = createTuiSession({
        sessionId,
        send: async (text: string): Promise<void> => {
          if (agent === undefined) {
            notice(`session unavailable: ${failureNotice ?? 'unknown error'}`)
            return
          }
          try {
            await agent.followup(createUserMessage({
              content: [{ type: 'text', text }],
              source: { kind: 'user' },
            }))
          } catch (error: unknown) {
            notice(`send failed: ${messageOf(error)}`)
          }
        },
      })
      notice = (text: string): void => { session.receive({ kind: 'assistant', text }) }
      if (failureNotice !== undefined) {
        notice(`session unavailable: ${failureNotice}`)
        modelLabel = 'session unavailable'
      }
      const stopEvents = ctx.on('session/event', (subject: unknown, event: SessionEvent): void => {
        if (agent === undefined || subject !== agent.session) return
        for (const entry of feed.push(event)) session.receive(entry)
      })
      const stopErrors = ctx.on('agent/error', ({ agent: subject, error }: { readonly agent: Agent; readonly error: unknown }): void => {
        if (subject !== agent) return
        notice(`agent error: ${messageOf(error)}`)
      })

      const instance = renderTuiApp({
        onPrompt: text => session.submit(text),
        onCommand: (name: string): void => {
          if (name === 'help') {
            for (const line of HELP_LINES) notice(line)
            return
          }
          notice(`unknown command :${name}; :help lists the built-ins`)
        },
        onExit: (): void => {
          void (async (): Promise<void> => {
            stopEvents()
            stopErrors()
            approvals.close()
            try {
              if (agent !== undefined) await sessions.flush(agent.session)
            } catch (error: unknown) {
              process.stderr.write(`dsh: ${messageOf(error)}\n`)
              instance.unmount()
              exit(1)
              return
            }
            instance.unmount()
            exit(0)
          })()
        },
        transcriptSource: {
          current: () => session.transcript(),
          subscribe: callback => session.subscribe(callback),
        },
        approvals,
        runningDebugSessions: (): readonly string[] => {
          const debug = ctx.get('debug')
          if (debug === undefined) return []
          return debug.list()
            .filter(info => info.state !== 'terminated' && info.state !== 'failed')
            .map(info => info.id)
        },
        statusLabel: `session ${sessionId} · ${modelLabel}`,
      })
      resolve()
    })().catch((error) => { reject(error) })
  })
}
