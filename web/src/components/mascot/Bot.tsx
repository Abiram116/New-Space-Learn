/**
 * `Bot` is the light half of the mascot: the props, the Settings switch and a
 * size-exact slot. The drawing itself (`BotFace` + mascot.css, ~9KB gz) is
 * fetched the first time any bot mounts, so screens in the entry chunk (Home,
 * the offline banner, empty states) can place a bot without carrying it.
 *
 * Until the face arrives the slot holds the bot's exact box, so nothing
 * around it moves when it pops in. Once loaded it renders synchronously for
 * the rest of the session.
 */
import { useEffect, useSyncExternalStore, type ComponentType } from 'react'
import type { AgentId } from './agents'
import type { BotMood } from './moods'
import { useBotsShown } from '../../lib/botPreference'
import './speech.css'

export interface BotProps {
  agent?: AgentId
  mood?: BotMood
  /** Rendered width/height in px. Reads down to 40. */
  size?: number
  className?: string
  /** Makes the bot meaningful (role="img"). Omit and it is decorative. */
  label?: string
  /** Tooltip text; implies `label` when `label` is absent. */
  title?: string
  /** Idle eyes follow the pointer (transform-only, off under reduced motion). */
  look?: boolean
}

let Face: ComponentType<BotProps> | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Fetch the drawn face. Safe to call any number of times; resolves once loaded. */
export function loadBotFace(): Promise<void> {
  loading ??= import('./BotFace').then(
    (m) => {
      Face = m.BotFace
      listeners.forEach((l) => l())
    },
    (err) => {
      // A failed chunk (offline, deploy swap) must not wedge every bot: let
      // the next mount try again. The slot simply stays empty meanwhile.
      loading = null
      throw err
    },
  )
  return loading
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}
const faceNow = () => Face

/** Renders nothing when the student has switched the bots off (Settings). */
export function Bot(props: BotProps) {
  return useBotsShown() ? <LazyFace {...props} /> : null
}

function LazyFace(props: BotProps) {
  const F = useSyncExternalStore(subscribe, faceNow, faceNow)
  useEffect(() => {
    if (!F) loadBotFace().catch(() => {})
  }, [F])
  if (F) return <F {...props} />
  const size = props.size ?? 96
  return (
    <span
      aria-hidden
      className={props.className ? `bot-slot ${props.className}` : 'bot-slot'}
      data-agent={props.agent ?? 'tutor'}
      style={{ width: size, height: size }}
    />
  )
}
