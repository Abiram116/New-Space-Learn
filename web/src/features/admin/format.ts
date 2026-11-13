/** Small helpers shared by the admin screens. */

/** 1–2 unhappy, 3 middling, 4–5 happy — the colour a person's rating is shown in. */
export function scoreTone(score: number | null): string {
  if (score === null) return 'bg-line text-muted'
  if (score <= 2) return 'bg-coral-soft text-coral-deep'
  if (score === 3) return 'bg-sun-soft text-sun-deep'
  return 'bg-jade-soft text-jade-deep'
}

export function percent(part: number, whole: number): number {
  return whole ? Math.round((100 * part) / whole) : 0
}
