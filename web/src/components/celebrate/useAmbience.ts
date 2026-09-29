/**
 * The ambience controller and its context — see `Ambience.tsx` for the room
 * itself. Split out so the component file only exports components.
 */

import { createContext, useContext, useMemo, useRef } from 'react'
import { useReducedMotion } from '../ui/motion'
import { EASE } from './easing'

export type Pulse = 'good' | 'bright' | 'soft' | 'miss'

export type Ambience = {
  /** 0..1 through the session. */
  progress: (p: number) => void
  pulse: (kind: Pulse) => void
}

const NOOP: Ambience = { progress: () => {}, pulse: () => {} }
export const AmbienceContext = createContext<Ambience>(NOOP)

/** The nearest session's ambience, or a no-op outside one — so a component
 *  can react to its own events without knowing whether it's in a room. */
export const useAmbience = () => useContext(AmbienceContext)

const PULSE: Record<Exclude<Pulse, 'miss'>, { c: string; peak: number }> = {
  good: { c: 'var(--color-mint)', peak: 0.2 },
  bright: { c: 'var(--color-jade)', peak: 0.3 },
  soft: { c: 'var(--color-sun)', peak: 0.12 },
}

type Nodes = {
  root: HTMLDivElement | null
  warm: HTMLDivElement | null
  cool: HTMLDivElement | null
  pulse: HTMLDivElement | null
}

/** For a component that renders its own field (see `AmbienceField`). */
export function useAmbienceField() {
  const nodes = useRef<Nodes>({ root: null, warm: null, cool: null, pulse: null })
  const reduced = useReducedMotion()
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  const api = useMemo<Ambience>(
    () => ({
      progress(p) {
        const { warm, cool } = nodes.current
        const k = Math.min(1, Math.max(0, p))
        if (warm) warm.style.opacity = String(0.1 + 0.14 * k)
        if (cool) cool.style.opacity = String(0.13 - 0.06 * k)
      },
      pulse(kind) {
        const { root, pulse } = nodes.current
        if (reducedRef.current || document.hidden) return
        if (kind === 'miss') {
          root?.animate?.([{ opacity: 1 }, { opacity: 0.45, offset: 0.3 }, { opacity: 1 }], {
            duration: 1500,
            easing: 'ease-in-out',
          })
          return
        }
        if (!pulse?.animate) return
        const { c, peak } = PULSE[kind]
        pulse.style.setProperty('--c', c)
        pulse.animate(
          [
            { opacity: 0, transform: 'scale(1.4)' },
            { opacity: peak, transform: 'scale(2.4)', offset: 0.28 },
            { opacity: 0, transform: 'scale(3.4)' },
          ],
          { duration: kind === 'bright' ? 1600 : 1200, easing: EASE.sl },
        )
      },
    }),
    [],
  )
  return { nodes, api }
}

export type AmbienceHandle = ReturnType<typeof useAmbienceField>
