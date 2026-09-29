import { useEffect, useRef, type RefObject } from 'react'
import { EASE } from '../../components/celebrate/easing'

/**
 * The physical half of a flip: the card lifts off the table while it turns
 * and settles back, and each new card is dealt in from the right. Both are
 * WAAPI on the wrapper — transform and opacity only — so the button's own
 * rotation transition is never interrupted. Shared with the dock's loop.
 */
export function useCardMotion(
  ref: RefObject<HTMLElement | null>,
  index: number,
  flipped: boolean,
  reduced: boolean,
) {
  const prev = useRef<{ index: number; flipped: boolean } | null>(null)
  useEffect(() => {
    const el = ref.current
    const was = prev.current
    prev.current = { index, flipped }
    if (reduced || !el?.animate) return
    if (!was || was.index !== index) {
      el.animate(
        [
          { transform: 'translateX(34px) rotate(2.5deg) scale(0.97)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 520, easing: EASE.spring },
      )
    } else if (was.flipped !== flipped) {
      el.animate(
        [
          { transform: 'none' },
          { transform: 'translateY(-12px) scale(1.035)', offset: 0.42 },
          { transform: 'none' },
        ],
        { duration: 700, easing: EASE.inOut },
      )
    }
  }, [ref, index, flipped, reduced])
}
