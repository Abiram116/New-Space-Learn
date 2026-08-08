/**
 * Runs the frontend's SM-2 mirror over cases supplied by the Python test.
 *
 * Reads a JSON array of `{ease, interval_days, reps, grade}` on argv[2],
 * prints a JSON array of `{ease, interval_days, reps}` results on stdout.
 * The Python side compares. Nothing is asserted here — this script's only
 * job is to execute the real TypeScript, so parity is proven against the
 * shipped implementation rather than a transcription of it.
 *
 * Requires Node ≥22 (native TypeScript type-stripping). The Python test skips
 * itself if this can't run.
 */

import { readFileSync } from 'node:fs'
import { nextSchedule } from '../../web/src/lib/schedule.ts'

const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const results = cases.map((c) =>
  nextSchedule({ ease: c.ease, interval_days: c.interval_days, reps: c.reps }, c.grade),
)
process.stdout.write(JSON.stringify(results))
