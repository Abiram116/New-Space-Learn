/**
 * The quiet study room, as a set of shared values.
 *
 * Two places draw this room: the threshold transition (`features/transitions`)
 * and the onboarding backdrop (`features/onboarding`). The transition's whole
 * design depends on ending on the *exact* frame the destination begins — that
 * is what makes the curtain lift read as a continuity cut rather than a
 * crossfade between two similar pictures.
 *
 * A comment claiming they match is worth nothing the first time someone
 * retunes one gradient. Sharing the values is the only version of that claim
 * that stays true, and a near-match is the worst outcome available here: close
 * enough to look intentional, different enough to flicker at the cut.
 *
 * Lives in `lib/` rather than either feature so neither has to depend on the
 * other for its own background.
 */

/** The lamp: one warm source, high and slightly off the top edge. */
export const LAMP_BASE_WARMTH = 0.13

export function lampGradient(warmth: number = LAMP_BASE_WARMTH): string {
  return (
    `radial-gradient(80rem 52rem at 50% -18%, rgba(255,176,116,${warmth}), transparent 66%),` +
    'radial-gradient(44rem 34rem at 50% 8%, rgba(255,214,170,0.07), transparent 60%)'
  )
}

/** The table: the product's graticule, masked to the lit pool. */
export const TABLE_IMAGE =
  'linear-gradient(to right, rgba(245,237,228,0.032) 1px, transparent 1px),' +
  'linear-gradient(to bottom, rgba(245,237,228,0.032) 1px, transparent 1px)'

export const TABLE_SIZE = '30px 30px'

export const TABLE_MASK = 'radial-gradient(78% 62% at 50% 26%, #000 22%, transparent 92%)'

/** The room falling away at the edges. */
export const VIGNETTE =
  'radial-gradient(130% 100% at 50% 30%, transparent 32%, rgba(18,14,12,0.55) 78%, rgba(14,11,9,0.82) 100%)'

/**
 * Dust in the lamplight — the one moving thing, and the reason this reads as a
 * room rather than a gradient. Durations of 30–60s: slow enough that you never
 * catch one moving, you only notice the field has changed when you look back.
 */
export const MOTES = [
  { x: 22, y: 34, s: 2.5, o: 0.3, d: 0, dur: 52 },
  { x: 31, y: 58, s: 1.5, o: 0.2, d: 7, dur: 44 },
  { x: 44, y: 26, s: 2, o: 0.26, d: 3, dur: 60 },
  { x: 52, y: 47, s: 1.5, o: 0.16, d: 12, dur: 38 },
  { x: 39, y: 71, s: 3, o: 0.22, d: 5, dur: 56 },
  { x: 60, y: 63, s: 1.5, o: 0.18, d: 16, dur: 47 },
  { x: 68, y: 38, s: 2, o: 0.24, d: 9, dur: 41 },
  { x: 27, y: 18, s: 1.5, o: 0.14, d: 20, dur: 58 },
  { x: 57, y: 15, s: 2, o: 0.2, d: 14, dur: 50 },
] as const
