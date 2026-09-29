/**
 * The curves study motion speaks, in one place.
 *
 * `sl`, `expo` and `inOut` are the app's own tokens (`--ease-sl`,
 * `--ease-out-expo`, `--ease-in-out-sl` in index.css), repeated as numbers
 * because WAAPI easing strings can't read a CSS variable. `spring` and `flip`
 * are new and genuinely different shapes: they overshoot. A card has weight,
 * so it turns a few degrees past its face and settles back; a right answer
 * rises to meet you and lands. `--ease-spring` in celebrate.css mirrors
 * `spring` — change one, change both.
 */
const EASE_POINTS = {
  sl: '0.22, 1, 0.36, 1',
  expo: '0.16, 1, 0.3, 1',
  inOut: '0.65, 0, 0.35, 1',
  spring: '0.34, 1.56, 0.64, 1',
  flip: '0.34, 1.28, 0.5, 1',
} as const

type Curve = keyof typeof EASE_POINTS

const curve = (k: Curve) => `cubic-bezier(${EASE_POINTS[k]})`

export const EASE: Record<Curve, string> = {
  sl: curve('sl'),
  expo: curve('expo'),
  inOut: curve('inOut'),
  spring: curve('spring'),
  flip: curve('flip'),
}
