/**
 * Runs the frontend's FSRS-5 mirror over cases supplied by the Python test.
 *
 * Reads a JSON array of `{stability, difficulty, elapsed_days, grade}` on
 * argv[2] (`stability`/`difficulty`/`elapsed_days` are `null` for a
 * never-reviewed card), prints a JSON array of `{stability, difficulty,
 * retrievability, interval_days}` results on stdout. The Python side
 * compares. Nothing is asserted here — this script's only job is to execute
 * the real TypeScript, so parity is proven against the shipped
 * implementation rather than a transcription of it.
 *
 * Requires Node ≥22 (native TypeScript type-stripping). The Python test skips
 * itself if this can't run.
 */

import { readFileSync } from 'node:fs'
import { nextState } from '../../web/src/lib/schedule.ts'

const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const results = cases.map((c) =>
  nextState({ stability: c.stability, difficulty: c.difficulty }, c.elapsed_days ?? 0, c.grade),
)
process.stdout.write(JSON.stringify(results))
