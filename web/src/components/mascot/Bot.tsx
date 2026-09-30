import { useEffect, useId, useRef, type CSSProperties } from 'react'
import { AGENTS, type AgentId } from './agents'
import { POSES, type BotMood } from './moods'
import { followPointer, phaseFrom, watchVisibility } from './runtime'
import './mascot.css'
import { useBotsEnabled } from '../../lib/botPreference'

export interface BotProps {
  agent?: AgentId
  mood?: BotMood
  /** Rendered width/height in px. Reads down to 48. */
  size?: number
  className?: string
  /** Makes the bot meaningful (role="img"). Omit and it is decorative. */
  label?: string
  /** Tooltip text; implies `label` when `label` is absent. */
  title?: string
  /** Idle eyes follow the pointer (transform-only, off under reduced motion). */
  look?: boolean
}

const EYE_L = 47
const EYE_R = 73
const EYE_Y = 52

const TIPS: Record<AgentId, React.ReactNode> = {
  tutor: (
    <path
      className="bot-tipshape"
      d="M0-7 1.94-2.67 6.66-2.16 3.14 1.02 4.11 5.66 0 3.3-4.11 5.66-3.14 1.02-6.66-2.16-1.94-2.67Z"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  ),
  cards: (
    <g transform="rotate(14)">
      <rect className="bot-tipshape" x="-5" y="-6.5" width="10" height="13" rx="2.2" />
      <path className="bot-tipmark" d="M-2.2-2.5h4.4M-2.2 1h3" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  ),
  quiz: (
    <g>
      <circle className="bot-tipshape" r="6.6" />
      <path
        className="bot-tipmark"
        d="M-2.4-2.3a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1 .9-1 1.6"
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
      <circle className="bot-tipdot" cx="0" cy="3.9" r="1" />
    </g>
  ),
  notes: (
    <g transform="rotate(38)">
      <rect className="bot-tipshape" x="-2.9" y="-5" width="5.8" height="9" rx="1" />
      <rect className="bot-tiperaser" x="-2.9" y="-8" width="5.8" height="3.4" rx="1.2" />
      <path className="bot-tipwood" d="M-2.9 4h5.8L0 9.2Z" />
      <path className="bot-tipdot" d="M-1 7.4h2L0 9.2Z" />
    </g>
  ),
}

const EMBLEMS: Record<AgentId, React.ReactNode> = {
  tutor: <path d="M0-5.5C.7-1.2 1.2-.7 5.5 0 1.2.7.7 1.2 0 5.5-.7 1.2-1.2.7-5.5 0-1.2-.7-.7-1.2 0-5.5Z" />,
  cards: (
    <g>
      <rect x="-6" y="-4.5" width="7.5" height="9.5" rx="1.8" transform="rotate(-12)" opacity=".55" />
      <rect x="-1.8" y="-5" width="7.5" height="9.5" rx="1.8" transform="rotate(8)" />
    </g>
  ),
  quiz: <path d="M-4.5.2-1.3 3.4 4.8-3.4" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
  notes: <path d="M-4.5-3.2h9M-4.5.2h9M-4.5 3.6h5" fill="none" strokeWidth="2" strokeLinecap="round" />,
}

/** Seven sparks around the head: [x, y, scale, colour slot]. */
const SPARKS: [number, number, number, number][] = [
  [-50, -18, 1, 0],
  [-38, -46, 0.7, 1],
  [-6, -58, 0.8, 2],
  [34, -48, 1.05, 0],
  [52, -14, 0.75, 1],
  [48, 22, 0.9, 2],
  [-50, 20, 0.65, 0],
]

const SPARK = 'M0-6C.8-1.4 1.4-.8 6 0 1.4.8.8 1.4 0 6-.8 1.4-1.4.8-6 0-1.4-.8-.8-1.4 0-6Z'

function Eye({ x, side }: { x: number; side: 'l' | 'r' }) {
  return (
    <g transform={`translate(${x} ${EYE_Y})`}>
      <g className={`bot-eye bot-eye-${side}`}>
        <g className="bot-blink">
          <g className="bot-eo">
            <rect className="bot-halo" x="-8.5" y="-11" width="17" height="22" rx="8.5" />
            <rect className="bot-iris" x="-5.8" y="-8.2" width="11.6" height="16.4" rx="5.8" />
            <circle className="bot-glint" cx="-2" cy="-4" r="1.8" />
          </g>
        </g>
        <path className="bot-eh bot-stroke" d="M-6.2 2.6Q0-6.4 6.2 2.6" />
        <path className="bot-es" d={SPARK} />
        <path className="bot-ec bot-stroke" d="M-5.8-.5Q0 5 5.8-.5" />
        <rect className="bot-lid" x="-9" y="-28" width="18" height="20" />
      </g>
    </g>
  )
}

/** Renders nothing when the student has switched the bots off (Settings). */
export function Bot(props: BotProps) {
  return useBotsEnabled() ? <BotFace {...props} /> : null
}

function BotFace({ agent = 'tutor', mood = 'idle', size = 96, className, label, title, look = false }: BotProps) {
  const ref = useRef<SVGSVGElement>(null)
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const clip = `bot-screen-${uid}`
  const meta = AGENTS[agent]
  const pose = POSES[mood] ?? POSES.idle
  const name = label ?? title

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const stopVis = watchVisibility(el)
    const stopLook = look ? followPointer(el) : undefined
    return () => {
      stopVis()
      stopLook?.()
    }
  }, [look])

  const style = {
    '--bc': meta.color,
    '--bt': meta.tip,
    '--es': pose.es,
    '--lid': `${(pose.lid * 16).toFixed(1)}px`,
    '--al': `${pose.al}deg`,
    '--ar': `${pose.ar}deg`,
    '--tilt': `${pose.tilt}deg`,
    '--lift': `${pose.lift}px`,
    '--gx': `${pose.gx}px`,
    '--gy': `${pose.gy}px`,
    '--cheek': pose.cheek,
    '--glow': pose.glow,
    '--reach': pose.reach,
    '--ph': `-${phaseFrom(uid)}ms`,
  } as CSSProperties

  return (
    <svg
      ref={ref}
      className={className ? `bot ${className}` : 'bot'}
      data-agent={agent}
      data-mood={mood}
      data-eyes={pose.eyes}
      data-mouth={pose.mouth}
      data-brows={pose.brows}
      data-fx={pose.fx}
      data-thumb={pose.thumb ? '' : undefined}
      data-small={size < 72 ? '' : undefined}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      style={style}
      role={name ? 'img' : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
      focusable="false"
    >
      {name && <title>{title ?? name}</title>}
      <defs>
        <radialGradient id={`${clip}-g`}>
          <stop offset="0" stopColor={meta.tip} stopOpacity=".9" />
          <stop offset="1" stopColor={meta.tip} stopOpacity="0" />
        </radialGradient>
        <clipPath id={clip}>
          <rect x="29" y="33" width="62" height="40" rx="16" />
        </clipPath>
      </defs>
      <g transform="translate(60 113)">
        <ellipse className="bot-shadow" rx="24" ry="3.5" />
      </g>
      <g className="bot-rig">
        <g transform="translate(60 106)">
        <g className="bot-float">
        <g transform="translate(-60 -106)">
          <g className="bot-bodyg">
            <rect className="bot-body" x="40" y="72" width="40" height="34" rx="15" />
            <g className="bot-emblem" transform="translate(60 94)">
              {EMBLEMS[agent]}
            </g>
          </g>
          <g transform="translate(60 82)">
            <g className="bot-head">
              <g className="bot-headanim">
              <g transform="translate(-60 -82)">
                <ellipse className="bot-dark" cx="60" cy="23" rx="5.5" ry="2.8" />
                <path className="bot-stalk" d="M60 23V14" />
                <g transform="translate(60 10)">
                  <g className="bot-orbit">
                    <circle cx="0" cy="-11" r="1.8" />
                    <circle cx="0" cy="11" r="1.4" />
                  </g>
                  <g className="bot-tip">
                    <circle className="bot-tipglow" r="13" fill={`url(#${clip}-g)`} />
                    {TIPS[agent]}
                  </g>
                </g>
                <rect className="bot-dark" x="12.5" y="42" width="13" height="22" rx="6.5" />
                <rect className="bot-dark" x="94.5" y="42" width="13" height="22" rx="6.5" />
                <rect className="bot-dark" x="20" y="22" width="80" height="62" rx="27" />
                <rect className="bot-shell" x="20" y="22" width="80" height="57" rx="26" />
                <rect className="bot-gloss" x="31" y="26.5" width="18" height="4.6" rx="2.3" />
                <rect className="bot-screen" x="29" y="33" width="62" height="40" rx="16" />
                <g clipPath={`url(#${clip})`}>
                  <ellipse className="bot-cheek" cx="37.5" cy="63" rx="4.6" ry="2.7" />
                  <ellipse className="bot-cheek" cx="82.5" cy="63" rx="4.6" ry="2.7" />
                  <g className="bot-look">
                    <g className="bot-gaze">
                      <Eye x={EYE_L} side="l" />
                      <Eye x={EYE_R} side="r" />
                      <g transform={`translate(${EYE_L} 40.5)`}>
                        <path className="bot-brow bot-brow-l bot-stroke" d="M-5 0H5" />
                      </g>
                      <g transform={`translate(${EYE_R} 40.5)`}>
                        <path className="bot-brow bot-brow-r bot-stroke" d="M-5 0H5" />
                      </g>
                    </g>
                  </g>
                  <g transform="translate(60 65)">
                    <path className="bot-m bot-m-smile bot-stroke" d="M-5-1Q0 4 5-1" />
                    <path className="bot-m bot-m-grin" d="M-7-2.2H7Q7 5.8 0 5.8-7 5.8-7-2.2Z" />
                    <ellipse className="bot-m bot-m-o bot-stroke" rx="2.5" ry="2.9" />
                    <path className="bot-m bot-m-wobble bot-stroke" d="M-6.5 1Q-4.9-1.8-3.2 1T0 1T3.2 1T6.5 1" />
                    <ellipse className="bot-m bot-m-yawn" rx="4.6" ry="5.8" />
                    <path className="bot-m bot-m-smug bot-stroke" d="M-6 0Q-.5 4.4 6-2.2" />
                    <g className="bot-m bot-m-tongue">
                      <path className="bot-tongue" d="M.4 0Q3.6 6.4 6.8 0Z" />
                      <path className="bot-stroke" d="M-5 0H6" />
                    </g>
                  </g>
                </g>
                <g transform="translate(94 31)">
                  <path className="bot-sweat" d="M0-5.5C2.6-1.7 3.8.5 3.8 2.1A3.8 3.8 0 0 1-3.8 2.1C-3.8.5-2.6-1.7 0-5.5Z" />
                </g>
              </g>
              </g>
            </g>
          </g>
          <g transform="translate(40 86)">
            <g className="bot-arm bot-arm-l">
              <g className="bot-armanim">
                <rect className="bot-dark bot-stick" x="-4.5" y="-3" width="9" height="19" rx="4.5" />
                <g className="bot-reach">
                  <circle className="bot-hand" cy="18" r="6" />
                </g>
              </g>
            </g>
          </g>
          <g transform="translate(80 86)">
            <g className="bot-arm bot-arm-r">
              <g className="bot-armanim">
                <rect className="bot-dark bot-stick" x="-4.5" y="-3" width="9" height="19" rx="4.5" />
                <g className="bot-reach">
                  <rect className="bot-thumb" x="-2.4" y="17" width="4.8" height="13" rx="2.4" />
                  <circle className="bot-hand" cy="18" r="6" />
                </g>
              </g>
            </g>
          </g>
        </g>
        </g>
        </g>
      </g>
      <g className="bot-fxs" transform="translate(60 50)">
        {SPARKS.map(([x, y, s, c], i) => (
          <g key={i} className="bot-spark" style={{ '--sx': `${x}px`, '--sy': `${y}px`, '--ss': s, '--i': i } as CSSProperties}>
            <path d={SPARK} data-c={c} />
          </g>
        ))}
      </g>
      <g className="bot-zzz" transform="translate(88 24)">
        {[0, 1, 2].map((i) => (
          <g key={i} className="bot-z" style={{ '--i': i } as CSSProperties}>
            <path className="bot-stroke" d="M-3-3H3L-3 3H3" />
          </g>
        ))}
      </g>
      <g className="bot-dots">
        <circle cx="95" cy="30" r="2.2" style={{ '--i': 0 } as CSSProperties} />
        <circle cx="102" cy="21" r="3" style={{ '--i': 1 } as CSSProperties} />
        <circle cx="110" cy="10" r="3.9" style={{ '--i': 2 } as CSSProperties} />
      </g>
    </svg>
  )
}
