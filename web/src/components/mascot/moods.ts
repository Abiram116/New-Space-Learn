/**
 * Every mood is a POSE (static, tweened between by CSS transitions) plus an
 * optional LOOP (keyframes in mascot.css, keyed by `data-mood`). The pose is
 * what reduced-motion users see, so each one must read on its own.
 */

export type BotMood =
  | 'idle'
  | 'wave'
  | 'happy'
  | 'celebrate'
  | 'proud'
  | 'cheer'
  | 'thinking'
  | 'working'
  | 'curious'
  | 'encouraging'
  | 'sleepy'
  | 'waking'
  | 'oops'
  | 'lookaround'

export const BOT_MOODS: readonly BotMood[] = [
  'idle',
  'wave',
  'happy',
  'celebrate',
  'proud',
  'cheer',
  'thinking',
  'working',
  'curious',
  'encouraging',
  'sleepy',
  'waking',
  'oops',
  'lookaround',
]

export type Eyes = 'open' | 'happy' | 'star' | 'closed'
export type Mouth = 'smile' | 'grin' | 'o' | 'wobble' | 'yawn' | 'smug' | 'tongue'
export type Brows = 'none' | 'worried' | 'raised' | 'focus'
export type Fx = 'none' | 'spark' | 'zzz' | 'sweat' | 'dots' | 'orbit'

export interface Pose {
  eyes: Eyes
  mouth: Mouth
  brows: Brows
  fx: Fx
  /** Open-eye scale (wide > 1 > squint). */
  es: number
  /** Upper-lid drop, 0..1 of the eye. */
  lid: number
  /** Arm angles (deg). 0 hangs straight down; ± swings outward. */
  al: number
  ar: number
  /** Head tilt (deg) and whole-body lift (px, negative = up). */
  tilt: number
  lift: number
  /** Where the eyes rest before the pointer nudges them. */
  gx: number
  gy: number
  cheek: number
  /** Antenna tip glow 0..1. */
  glow: number
  /** Arm extension when raised (1 = stubby rest length). */
  reach: number
  thumb?: boolean
}

const BASE: Pose = {
  eyes: 'open',
  mouth: 'smile',
  brows: 'none',
  fx: 'none',
  es: 1,
  lid: 0,
  al: 16,
  ar: -16,
  tilt: 0,
  lift: 0,
  gx: 0,
  gy: 0,
  cheek: 0.45,
  glow: 0.55,
  reach: 1,
}

const p = (o: Partial<Pose>): Pose => ({ ...BASE, ...o })

export const POSES: Record<BotMood, Pose> = {
  idle: BASE,
  lookaround: p({ es: 1.04 }),
  wave: p({ eyes: 'happy', mouth: 'grin', ar: -112, reach: 1.35, tilt: -4, cheek: 0.7 }),
  happy: p({ eyes: 'happy', mouth: 'grin', al: 30, ar: -30, cheek: 0.8, glow: 0.8 }),
  celebrate: p({ eyes: 'star', mouth: 'grin', fx: 'spark', al: 122, ar: -122, reach: 1.55, lift: -3, cheek: 0.9, glow: 1 }),
  proud: p({ eyes: 'happy', mouth: 'smug', al: 34, ar: -34, tilt: -5, lift: -2, gy: -1, cheek: 0.7, glow: 0.8 }),
  cheer: p({ eyes: 'happy', mouth: 'grin', al: 40, ar: -124, reach: 1.35, lift: -2, cheek: 0.85, glow: 0.9 }),
  thinking: p({ mouth: 'o', brows: 'raised', fx: 'dots', al: -150, gx: 3.5, gy: -3.5, tilt: 5, cheek: 0.25, glow: 0.9 }),
  working: p({ mouth: 'tongue', fx: 'orbit', es: 0.96, al: 44, ar: -44, gy: 2.5, cheek: 0.3, glow: 0.9 }),
  curious: p({ mouth: 'o', brows: 'raised', es: 1.14, tilt: -11, gx: -1.5, cheek: 0.4 }),
  encouraging: p({ eyes: 'happy', mouth: 'smile', ar: -118, reach: 1.3, thumb: true, tilt: 4, cheek: 0.75 }),
  sleepy: p({ eyes: 'closed', mouth: 'o', fx: 'zzz', al: 8, ar: -8, tilt: 7, lift: 2, cheek: 0.3, glow: 0.18 }),
  waking: p({ mouth: 'smile', cheek: 0.5 }),
  oops: p({ mouth: 'wobble', brows: 'worried', fx: 'sweat', es: 0.92, al: 36, ar: -36, gy: 1, cheek: 0.2, glow: 0.35 }),
}

/** Moods where idle eyes may follow the pointer. */
export const FOLLOW_MOODS: ReadonlySet<string> = new Set<BotMood>(['idle', 'wave', 'happy', 'curious', 'encouraging', 'proud'])
