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

describe('motion language', () => {
  /**
   * The app commits to two easing curves — `--ease-sl` for app motion and
   * `--ease-out-expo` for the landing page's longer moves — and the stylesheet
   * goes to unusual lengths to enforce them, including an unlayered rule that
   * exists purely to beat Tailwind's default curve.
   *
   * That enforcement only covers CSS transitions. Inline styles and Tailwind
   * arbitrary values bypass it entirely, and four had drifted: the same two
   * curves written out longhand, plus one element running `ease-out` on its
   * opacity while its transform ran on an expo — a single declaration speaking
   * two dialects.
   *
   * Literal curves are the tell, so the test bans them rather than trying to
   * compare numbers.
   */
  /**
   * `index.html`'s inline splash is the one legitimate exception, and it is
   * exempt for a reason rather than for convenience: that CSS runs *before*
   * `index.css` has loaded, so `var(--ease-sl)` would resolve to nothing and
   * the splash would animate on the browser default. Writing the curve out is
   * the only way to have it there at all.
   */
  const EXEMPT = ['index.html']

  /** Comments are prose about the curves, not uses of them. */
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('uses the easing tokens rather than writing curves out longhand', () => {
    const offenders: string[] = []
    for (const { path, text } of SOURCES) {
      if (EXEMPT.some((e) => path.endsWith(e))) continue
      for (const line of stripComments(text).split('\n')) {
        if (!line.includes('cubic-bezier(')) continue
        // The token definitions themselves, and the landing page's GSAP bridge
        // which builds the same curve from shared numbers.
        if (line.includes('--ease-')) continue
        if (line.includes('EASE_POINTS')) continue
        offenders.push(`${path.replace(ROOT, '.')} → ${line.trim().slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('transition sets', () => {
  /**
   * Tailwind's catch-all transition utility is a jank source dressed as a
   * shorthand: it animates every animatable property, so a hover meant to
   * change one colour also tweens width, padding and font-size, each forcing
   * layout on every frame. Sixteen controls had it.
   *
   * The replacements name what each element actually changes (`t-control`,
   * `t-move`, `t-meter` in index.css). This stops the shorthand creeping back:
   * it is always easier to type than the correct thing.
   *
   * The needle is assembled rather than written out, for the same reason the
   * note in index.css avoids it — Tailwind scans this file as raw text and
   * would emit the very utility the test exists to ban.
   */
  const BANNED = ['transition', 'all'].join('-')

  it('never uses the catch-all transition utility', () => {
    const offenders: string[] = []
    for (const { path, text } of SOURCES) {
      // index.css documents the ban; it does not use it.
      if (path.endsWith('index.css')) continue
      text.split('\n').forEach((line, i) => {
        if (line.includes(BANNED)) {
          offenders.push(`${path.replace(ROOT, '.')}:${i + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('defines every transition set the app uses', () => {
    const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8')
    const used = new Set<string>()
    for (const { path, text } of SOURCES) {
      if (path.endsWith('index.css')) continue
      for (const m of text.matchAll(/\bt-(control|move|meter)\b/g)) used.add(`.t-${m[1]}`)
    }
    // A class that is used but never defined silently does nothing — the
    // element just snaps, which is exactly what this work set out to remove.
    for (const cls of used) expect(css).toContain(`${cls} {`)
  })
})
