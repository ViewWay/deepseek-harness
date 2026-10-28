/** Debug session throughput stays bounded while 10k console lines and paged inspection cross one backend. */
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runBuiltBenchmarkWorker } from '../support/built-worker.ts'
import { ciTimeBudget } from '../support/calibration.ts'
import { recordTimings, type BenchmarkCase, type Timing } from '../support/scaling-report.ts'
import type { DebugThroughputReport } from './session-throughput.worker.ts'

const ATTEMPTS = 5
const WORKER = join(import.meta.dirname, '..', '.dsh-build', 'debug', 'session-throughput.worker.js')
/** Calibration reference (Apple M4 Pro) expectations, before shared CI scaling and headroom. */
const EXPECTED_MS = { ingest: 40, cycles: 80 }
/** Whole-process CPU work; the scripted in-process wire has no storage or paced waits. */
const IO_SHARE = 0
const MAX_RETAINED_HEAP_BYTES = 24 * 1024 * 1024

const THROUGHPUT_CASE: BenchmarkCase = {
  id: 'debug-session-throughput/steady',
  measures: 'One backend ingesting 10k console lines then 25 stop/continue cycles of 20-frame stacks and 20-variable pages.',
  affects: 'Debug sessions that print large logs while the agent steps through stops.',
}

function median(values: readonly number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number
}

async function sample(): Promise<DebugThroughputReport> {
  const outcome = await runBuiltBenchmarkWorker<DebugThroughputReport>({
    worker: WORKER, args: ['10000', '25', '20'], timeoutMs: 120_000, exposeGc: true,
  })
  if (outcome.timedOut || outcome.signal !== null || outcome.exitCode !== 0 || outcome.report === undefined) {
    throw new Error('debug throughput worker failed: ' + JSON.stringify(outcome))
  }
  return outcome.report
}

it('keeps debug session throughput bounded across console volume and paged stops', async () => {
  const samples: DebugThroughputReport[] = []
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) samples.push(await sample())
  const ingestBudgetMs = ciTimeBudget(EXPECTED_MS.ingest)
  const cyclesBudgetMs = ciTimeBudget(EXPECTED_MS.cycles)
  const ingestMedianMs = median(samples.map(row => row.ingestMs))
  const cyclesMedianMs = median(samples.map(row => row.cyclesMs))
  console.log(JSON.stringify({ scenario: 'debug-session-throughput', samples, ingestMedianMs, cyclesMedianMs, ingestBudgetMs, cyclesBudgetMs }))
  const declared = (ms: number): Timing => ({ ms, ioShare: IO_SHARE })
  recordTimings(THROUGHPUT_CASE, {
    ingestMs: declared(ingestMedianMs), cyclesMs: declared(cyclesMedianMs),
  }, { ingestMs: ingestBudgetMs, cyclesMs: cyclesBudgetMs })
  expect(ingestMedianMs).toBeLessThanOrEqual(ingestBudgetMs)
  expect(cyclesMedianMs).toBeLessThanOrEqual(cyclesBudgetMs)
  for (const report of samples) {
    expect(report.ringAtCap).toBe(true)
    expect(report.retainedHeapBytes).toBeLessThanOrEqual(MAX_RETAINED_HEAP_BYTES)
  }
})
