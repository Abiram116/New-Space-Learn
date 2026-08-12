/**
 * Runs the frontend's real `readSignal` over messages supplied by the Python
 * test, same idiom as `sm2_parity.mjs`: this script's only job is to execute
 * the shipped TypeScript, so parity is proven against what actually ships,
 * not a transcription of it. Nothing is asserted here — the Python side
 * compares each result against what `_IMPLICIT_PATTERNS` would classify.
 *
 * Reads a JSON array of strings on argv[2], prints a JSON array of
 * `'directed' | 'confusion' | 'regenerated' | 'none'` on stdout.
 *
 * Requires Node ≥22 (native TypeScript type-stripping). The Python test skips
 * itself if this can't run.
 */

import { readFileSync } from 'node:fs'
import { readSignal } from '../../web/src/features/chat/feedbackPolicy.ts'

const messages = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const results = messages.map((m) => readSignal(m))
process.stdout.write(JSON.stringify(results))
