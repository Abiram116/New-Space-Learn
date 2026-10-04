import type { BotMood } from './moods'

/** A feeling and what it settles into: a bot reacts, then rests, rather than staying in one pose. */
export type Arc = { mood: BotMood; settle: BotMood }

/**
 * How a companion meets a score. Wonder at the very top, a cheer for a good
 * one, and for a rough one encouragement rather than a sad face: the person
 * looking at it is the one who is disappointed, and does not need company in it.
 */
export function scoreArc(score: number): Arc {
  if (score >= 90) return { mood: 'awe', settle: 'love' }
  if (score >= 80) return { mood: 'celebrate', settle: 'proud' }
  if (score >= 50) return { mood: 'cheer', settle: 'happy' }
  return { mood: 'encouraging', settle: 'idle' }
}
