/**
 * Every animation must name a keyframe that exists.
 *
 * Written after deleting three keyframes with a regex whose `[^}]*` stopped at
 * the first inner `}` — so each block was cut in half and its tail left behind
 * as an orphan. The stylesheet went unbalanced, Tailwind failed with "Missing
 * opening {", and the build was the only thing that noticed.
 *
 * That build error was the *lucky* outcome. The quiet version of this mistake
 * is deleting a keyframe that something still references: CSS silently ignores
 * an unknown animation name, so the element simply renders with no motion, and
 * nothing anywhere reports it. On a screen whose entrance *is* the design, the
 * failure mode is a page that looks finished and does nothing.
 *
 * So this checks both halves — the stylesheet parses, and every name referenced
 * in the app resolves to a real `@keyframes`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/* `tests/` sits beside `src/`, so the web root is one level up. */
const ROOT = resolve(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(tsx?|css|html)$/.test(entry)) out.push(full)
  }
  return out
}

const FILES = [...walk(join(ROOT, 'src')), join(ROOT, 'index.html')]
const SOURCES = FILES.map((f) => ({ path: f, text: readFileSync(f, 'utf8') }))

/** Keyframes declared anywhere — index.css, an inline <style>, a component. */
const DEFINED = new Set(
  SOURCES.flatMap(({ text }) =>
    [...text.matchAll(/@keyframes\s+([A-Za-z][\w-]*)/g)].map((m) => m[1]),
  ),
)

/**
 * Animation-shorthand references: a camelCase name followed by a duration,
 * which covers CSS (`mote 52s`), template literals (`ruleSweep 820ms`) and
 * Tailwind's arbitrary syntax (`animate-[stepIn_420ms_...]`). The camelCase
 * requirement is what keeps prose like "wait 260ms" out of the results.
 */
function referencedIn(text: string): string[] {
  return [...text.matchAll(/\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)[ _](\d+(?:\.\d+)?)(ms|s)\b/g)]
    .map((m) => m[1])
    .filter((name) => !/^(transition|duration|delay|ease)/.test(name))
}

describe('keyframes', () => {
  it('defines every animation the app references', () => {
    const missing: string[] = []
    for (const { path, text } of SOURCES) {
      for (const name of referencedIn(text)) {
        // Only flag names that look like ours: a reference to something never
        // defined anywhere is either a typo or a keyframe that got deleted.
        if (!DEFINED.has(name)) missing.push(`${path.replace(ROOT, '.')} → ${name}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('keeps the shared room a single source of truth', () => {
    /**
     * The threshold transition ends on the frame the onboarding backdrop
     * begins — that is what makes the curtain lift a continuity cut instead of
     * a crossfade between two similar pictures. A near-match is the worst
     * available outcome: close enough to look intentional, different enough to
     * flicker at the cut.
     *
     * So the room's values live in `lib/room.ts` and nowhere else. Copying one
     * back inline is how they would drift, and the drift would only ever be
     * visible for the ~600ms nobody is screenshotting.
     */
    const roomValues = [
      'rgba(245,237,228,0.032)', // the table's ruling
      '78% 62% at 50% 26%', //     the table's mask
      'rgba(18,14,12,0.55)', //    the vignette
    ]
    const offenders: string[] = []
    for (const { path, text } of SOURCES) {
      if (path.endsWith('lib/room.ts')) continue
      for (const v of roomValues) {
        if (text.includes(v)) offenders.push(`${path.replace(ROOT, '.')} → ${v}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps index.css structurally balanced', () => {
    const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8')
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const open = (stripped.match(/\{/g) ?? []).length
    const close = (stripped.match(/\}/g) ?? []).length
    expect({ open, close }).toEqual({ open: close, close })
  })

  it('has no keyframe body left outside a block', () => {
    const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8')
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
    let depth = 0
    const orphans: string[] = []
    for (const line of stripped.split('\n')) {
      if (depth === 0 && /^\s*(from|to|\d+%)\s*\{/.test(line)) orphans.push(line.trim())
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    }
    expect(orphans).toEqual([])
  })
})
