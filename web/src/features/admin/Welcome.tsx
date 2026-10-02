/**
 * The hello after the right password: emoji splashed across the screen and a
 * greeting, for about two seconds, then the desk. A click or any key skips it.
 * With reduced motion it is not shown at all.
 */

import { useEffect, type CSSProperties } from 'react'

const EMOJI = ['💅', '👑', '🔥', '✨', '😎', '💃', '🎉', '🦄', '💖', '🤭', '🍾', '⚡', '🕶️', '💋', '🥳', '🌈', '😈', '🪩']
const SHOWN_MS = 2400

/** Where each one lands: spread round the middle, evenly, the same every time. */
const SPLASH = EMOJI.map((emoji, i) => {
  const angle = (i / EMOJI.length) * Math.PI * 2 + (i % 2 ? 0.3 : 0)
  const reach = 22 + ((i * 7) % 5) * 5 // 22–42, in viewport units
  return {
    emoji,
    x: `${(Math.cos(angle) * reach).toFixed(1)}vw`,
    y: `${(Math.sin(angle) * reach).toFixed(1)}vh`,
    r: `${((i * 47) % 70) - 35}deg`,
    size: 34 + ((i * 13) % 4) * 12,
    delay: i * 35,
  }
})

export function Welcome({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onDone()
      return
    }
    const timer = window.setTimeout(onDone, SHOWN_MS)
    window.addEventListener('keydown', onDone)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onDone)
    }
  }, [onDone])

  return (
    <div
      onClick={onDone}
      className="fixed inset-0 z-50 grid cursor-pointer place-items-center overflow-hidden bg-canvas/95 backdrop-blur-sm animate-[deskAway_420ms_ease-in_1980ms_forwards]"
    >
      <div aria-hidden>
        {SPLASH.map((s) => (
          <span
            key={s.emoji}
            className="absolute left-1/2 top-1/2 select-none opacity-0 animate-[deskSplat_700ms_var(--ease-out-expo)_forwards]"
            style={{ '--x': s.x, '--y': s.y, '--r': s.r, fontSize: s.size, animationDelay: `${s.delay}ms` } as CSSProperties}
          >
            {s.emoji}
          </span>
        ))}
      </div>
      <p
        role="status"
        className="nameplate relative px-6 text-center text-[clamp(40px,9vw,96px)] leading-[1.05] text-brand opacity-0 animate-[deskHello_650ms_var(--ease-out-expo)_180ms_forwards]"
      >
        Helloo, boss bitch <span aria-hidden>💅</span>
      </p>
    </div>
  )
}
