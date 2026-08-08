import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Logo } from '../../components/ui/Logo'
import { cn } from '../../lib/cn'
import { warmApi } from '../../lib/warmApi'
import { LitGrid, ParallaxLayer, usePointerParallax } from '../landing/motion'

/**
 * Split layout for the auth routes.
 *
 * The form stays narrow — sign-in is four fields and does not earn half a
 * screen — but not cramped against the edge. The panel takes everything else
 * and spreads the product's whole output across it: an answer with its
 * citation, a note, a quiz, a skill, a card, a streak, an indexed source.
 *
 * The pieces sit at different depths and answer the pointer at different
 * rates, and the lamp moves with the cursor so the ruled ground catches it.
 *
 * Below `xl` the panel is simply gone and the form stands alone. There is
 * deliberately NO stacked fallback: a phone arriving at sign-in does not need
 * the pitch repeated underneath the button it came to press, and the stacked
 * version only pushed the fold down.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: ReactNode
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  // Typing credentials is ~10–20s of cover to wake the free-tier backend, so
  // the data fetch immediately after login lands on a warm server instead of
  // paying the cold start in front of a spinner. Covers sign-in and sign-up,
  // which both render through here.
  useEffect(warmApi, [])

  return (
    <div className="grid min-h-full bg-canvas text-ink xl:grid-cols-[minmax(0,520px)_1fr]">
      <div className="mx-auto flex w-full max-w-md flex-col justify-center gap-7 px-7 py-12 sm:px-0 xl:mx-0 xl:max-w-none xl:px-16 2xl:px-20">
        <Link to="/welcome" aria-label="Space Learn">
          <Logo size={30} />
        </Link>

        <div className="flex max-w-sm flex-col gap-2.5">
          <h1 className="nameplate text-[clamp(30px,4.5vw,42px)] leading-[0.95] text-ink">
            {title}
          </h1>
          <p className="text-[14.5px] leading-relaxed text-muted">{subtitle}</p>
        </div>

        <div className="max-w-sm">{children}</div>
        <div className="max-w-sm text-[13px] text-muted">{footer}</div>
      </div>

      <ArtifactField />
    </div>
  )
}

type Piece = {
  icon: IconName
  kind: string
  tone: 'brand' | 'sky' | 'sun' | 'mint' | 'coral'
  title: string
  body?: string
  code?: string
  options?: string[]
  /** Position across the whole panel, in %. */
  x: number
  y: number
  w: number
  rot: number
  depth: number
  delay: number
}

/**
 * Seven artifacts — one per thing the platform actually makes, and each from a
 * different subject. Deliberately not the subjects the landing page uses:
 * across the two signed-out surfaces a visitor should see several fields of
 * study, not one course repeated.
 */
const PIECES: Piece[] = [
  {
    icon: 'chat',
    kind: 'Answer',
    tone: 'brand',
    title: 'Why does a price ceiling cause shortages?',
    body: 'Held under the market price, demand outruns supply — and the gap has to clear some other way, usually queues.',
    code: 'micro-ch7.pdf · p.88',
    x: 5,
    y: 36,
    w: 318,
    rot: -4,
    depth: 30,
    delay: 0,
  },
  {
    icon: 'quiz',
    kind: 'Quiz',
    tone: 'sky',
    title: 'A hash collision happens when…',
    options: ['two keys land in one bucket', 'a key exceeds the table size', 'the load factor hits zero'],
    code: '5 questions',
    x: 43,
    y: 5,
    w: 264,
    rot: 5,
    depth: 15,
    delay: 1.3,
  },
  {
    icon: 'skill',
    kind: 'Skill',
    tone: 'mint',
    title: 'Cite Everything',
    body: 'Answers only from your indexed documents, and refuses any claim it cannot source.',
    code: 'on in this topic',
    x: 70,
    y: 27,
    w: 256,
    rot: -6,
    depth: 40,
    delay: 0.6,
  },
  {
    icon: 'note',
    kind: 'Note',
    tone: 'coral',
    title: 'What set off the 1929 crash',
    body: 'Margin buying, a farm economy already stalling, and a Fed that tightened into the fall.',
    code: 'edited 2h ago',
    x: 33,
    y: 66,
    w: 268,
    rot: 6,
    depth: 22,
    delay: 2.1,
  },
  {
    icon: 'deck',
    kind: 'Card',
    tone: 'sun',
    title: 'What does one turn of the Krebs cycle yield?',
    body: 'Three NADH, one FADH2, one ATP, and two CO2.',
    code: 'due today',
    x: 63,
    y: 55,
    w: 244,
    rot: -3,
    depth: 34,
    delay: 1.7,
  },
  {
    icon: 'flame',
    kind: 'Streak',
    tone: 'brand',
    title: '14 days running',
    body: 'Every session counts once. Miss a day and it resets.',
    x: 4,
    y: 71,
    w: 232,
    rot: 7,
    depth: 26,
    delay: 2.6,
  },
  {
    icon: 'doc',
    kind: 'Source',
    tone: 'sky',
    title: 'thermo-lecture-04.pdf',
    body: '41 pages · indexed',
    x: 79,
    y: 80,
    w: 210,
    rot: 8,
    depth: 12,
    delay: 0.9,
  },
]

const TONE_CHIP: Record<Piece['tone'], string> = {
  brand: 'bg-brand-soft text-brand-deep',
  sky: 'bg-sky-soft text-sky-deep',
  sun: 'bg-sun-soft text-sun-deep',
  mint: 'bg-mint-soft text-mint-deep',
  coral: 'bg-coral-soft text-coral-deep',
}

function ArtifactField() {
  const { ref, pos, light, lit } = usePointerParallax<HTMLElement>()

  return (
    <aside
      ref={ref}
      className="relative hidden overflow-hidden border-l border-line bg-well xl:block"
    >
      {/* Ambient warmth only — the colour on this panel belongs to the cards. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(60ch 46ch at 24% 18%, #322319 0%, transparent 64%),' +
            'radial-gradient(52ch 40ch at 76% 82%, #2a1d17 0%, transparent 62%)',
        }}
      />

      {/* Ruled ground that catches the moving lamp. */}
      <LitGrid light={light} lit={lit} />

      {/* Thesis, top-left, clear of the spread. */}
      <div className="pointer-events-none absolute left-10 top-11 z-30 max-w-[19rem] xl:left-14">
        <h2 className="nameplate text-[clamp(28px,3vw,44px)] leading-[0.92] text-ink">
          Ask once.
          <br />
          <span className="text-brand">Keep the page.</span>
        </h2>
        <p className="mt-3 max-w-[19rem] text-[14px] leading-relaxed text-ink-3">
          Every answer cites the page it came from — then becomes a card, a note
          or a quiz that keeps testing you long after you've closed the PDF.
        </p>
      </div>

      {/* The spread, across the whole panel; edges bleed on purpose. */}
      <div className="absolute inset-0">
        {PIECES.map((p, i) => (
          <ParallaxLayer
            key={p.kind + i}
            depth={p.depth}
            pos={pos}
            className="absolute"
            style={{ left: `${p.x}%`, top: `${p.y}%`, zIndex: 10 + i }}
          >
            <article
              className="cardstock foil flex flex-col gap-2 rounded-xl p-3.5"
              style={
                {
                  width: p.w,
                  '--r': `${p.rot}deg`,
                  transform: `rotate(${p.rot}deg)`,
                  animation: `fieldBob 8s ${p.delay}s ease-in-out infinite`,
                } as CSSProperties
              }
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'grid h-6 w-6 shrink-0 place-items-center rounded-md',
                    TONE_CHIP[p.tone],
                  )}
                >
                  <Icon name={p.icon} size={13} />
                </span>
                <span className="setcode">{p.kind}</span>
              </div>

              <p className="nameplate text-[19px] leading-tight text-ink">{p.title}</p>

              {p.body && <p className="text-[13px] leading-relaxed text-muted">{p.body}</p>}

              {p.options && (
                <ul className="flex flex-col gap-1">
                  {p.options.map((opt, oi) => (
                    <li
                      key={opt}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12.5px]',
                        oi === 0
                          ? 'border-mint/40 bg-mint-soft text-mint-deep'
                          : 'border-line text-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border',
                          oi === 0 ? 'border-mint text-mint' : 'border-line-dash',
                        )}
                      >
                        {oi === 0 && <Icon name="check" size={9} />}
                      </span>
                      {opt}
                    </li>
                  ))}
                </ul>
              )}

              {p.code && (
                <div className="mt-0.5 flex items-center gap-1.5 border-t border-line pt-1.5">
                  <Icon name="doc" size={10} className="shrink-0 text-faint" />
                  <span className="setcode truncate">{p.code}</span>
                </div>
              )}
            </article>
          </ParallaxLayer>
        ))}
      </div>

      {/* Vignette, so cards bleeding off the edge read as intentional. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(125% 105% at 50% 50%, transparent 56%, rgba(21,17,16,0.75) 100%)',
        }}
      />

      <style>{`
        @keyframes fieldBob {
          0%,100% { transform: translateY(0) rotate(var(--r,0deg)); }
          50%     { transform: translateY(-11px) rotate(var(--r,0deg)); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="fieldBob"] { animation: none !important; }
        }
      `}</style>
    </aside>
  )
}
