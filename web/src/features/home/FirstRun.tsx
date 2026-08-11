/**
 * The dashboard, for an account that has nothing in it yet.
 *
 * Two jobs, in order. First make the *mechanism* obvious — what separates this
 * from a chat window is the hand-off: the same conversation that explained
 * something produces the note, the deck and the quiz about it, each traceable
 * to the page it came from. Then name the surfaces, because a student who does
 * not know Notes and Quizzes exist will never go looking for them.
 *
 * An earlier version showed the loop and stopped there. The loop is the right
 * spine, but three abstract panels do not tell you the notes editor has slash
 * commands or that cards are scheduled — so the product looked smaller than it
 * is at the exact moment someone is deciding whether to bother.
 *
 * **Skills and Agents get their own band.** They are the one distinction the
 * product cannot afford to have collapsed: a Skill changes *how the AI talks*
 * and stays on; an Agent *makes you something* and is done. Introducing them
 * as two more bullets in a feature list is how that gets muddled forever.
 *
 * **This is the whole page while it shows.** Once a subject exists Home reverts
 * to the standing figures and topic list — the introduction has done its job,
 * and repeating it would be the product explaining itself to someone already
 * using it.
 */

import { Button } from '../../components/ui/Button'
import { Icon, type IconName } from '../../components/ui/Icon'
import { useReducedMotion } from '../../components/ui/motion'
import { cn } from '../../lib/cn'
import { useHandoffReveal } from '../transitions/Handoff'

export function FirstRun({ onCreate }: { onCreate: () => void }) {
  const reduced = useReducedMotion()
  /**
   * Held until the curtain starts lifting.
   *
   * This page mounts *underneath* the handoff transition, so without this every
   * beat below ran and finished during the cover — and the entire sequence was
   * over before anyone could see it. It arrives as the curtain leaves instead.
   */
  const reveal = useHandoffReveal()

  /** Beat n of the entrance, in ms. */
  const at = (n: number) => {
    if (reduced) return undefined
    if (!reveal) return { opacity: 0 }
    return { animation: `stepIn 600ms ${n}ms var(--ease-sl) both` }
  }

  return (
    <section className="flex flex-col items-center py-4 text-center sm:py-8">
      <h1
        className="nameplate max-w-3xl text-[clamp(30px,5vw,54px)] leading-[1.02] text-ink"
        style={at(60)}
      >
        Bring what you're studying
      </h1>
      <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink-3" style={at(180)}>
        Drop a PDF or your lecture notes into a topic. Ask about them and every
        answer cites the page it came from — then hand that answer straight to a
        note, a deck, or a quiz.
      </p>

      <Loop reduced={reduced} reveal={reveal} />

      <div style={at(1180)} className="mt-11 flex flex-col items-center gap-3">
        <Button size="lg" onClick={onCreate}>
          Create your first subject
          <Icon name="arrowRight" size={15} />
        </Button>
        <p className="text-[13px] text-faint">
          A subject holds topics — “Reinforcement Learning”, then “Q-learning”.
        </p>
      </div>

      <Surfaces reveal={reveal} reduced={reduced} />
      <TwoKinds reveal={reveal} reduced={reduced} />
    </section>
  )
}

/* ── The loop ─────────────────────────────────────────────────────────── */

/**
 * Three panels and the hand-offs between them.
 *
 * Deliberately not a feature grid of matching cards: each panel is a different
 * material carrying different marks, and the connectors are what the diagram is
 * *about*. It reads as a row on desktop and a column on phones, where the
 * connectors rotate to keep pointing along the flow.
 */
function Loop({ reduced, reveal }: { reduced: boolean; reveal: boolean }) {
  const hold = !reveal && !reduced
  return (
    <div
      className="mt-12 flex w-full max-w-4xl flex-col items-stretch gap-3 sm:flex-row sm:items-center"
      aria-label="How Space Learn works: your material, a cited answer, then cards and quizzes made from it"
    >
      <Panel
        caption="Your material"
        note="PDFs and notes, chunked and indexed on upload"
        delay={340}
        hold={hold}
        reduced={reduced}
        className="cardstock rounded-[14px]"
      >
        <div className="flex items-center gap-1.5">
          <Icon name="doc" size={12} className="text-sky" />
          <span className="setcode truncate">lecture-06.pdf</span>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <Rule w="100%" />
          <Rule w="86%" />
          {/* The line the answer will cite. Marked, not highlighted — a
              drafting underline rather than a marker pen. */}
          <div className="relative">
            <Rule w="72%" tone="bright" />
            <span className="absolute -bottom-1 left-0 h-px w-[72%] bg-sky/60" />
          </div>
          <Rule w="92%" />
        </div>
      </Panel>

      <Connector delay={560} hold={hold} reduced={reduced} />

      <Panel
        caption="A cited answer"
        note="Every claim carries the document and page behind it"
        delay={700}
        hold={hold}
        reduced={reduced}
        className="leaf rounded-r-[14px]"
      >
        <div className="flex items-center gap-1.5">
          <Icon name="sparkle" size={12} className="text-brand" filled />
          <span className="setcode">answer</span>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <Rule w="94%" />
          <Rule w="100%" />
          <Rule w="64%" />
        </div>
        <span className="mt-3 inline-flex items-center gap-1 rounded-md bg-sky-soft px-1.5 py-0.5 text-[10.5px] font-bold text-sky-deep">
          1 · page 4
        </span>
      </Panel>

      <Connector delay={860} hold={hold} reduced={reduced} />

      <Panel
        caption="Something to be tested on"
        note="Cards come back on a schedule that tracks what you forget"
        delay={1000}
        hold={hold}
        reduced={reduced}
        className="cardstock rounded-[14px]"
      >
        <div className="flex items-center gap-1.5">
          <Icon name="deck" size={12} className="text-sun" />
          <span className="setcode">card 1 of 8</span>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <Rule w="88%" tone="bright" />
          <Rule w="56%" />
        </div>
        {/* Four grades on a rule — the real review control, in miniature. */}
        <div className="mt-3 flex gap-1">
          {['Again', 'Hard', 'Good', 'Easy'].map((g) => (
            <span
              key={g}
              className="flex-1 rounded-[5px] border border-line py-[3px] text-center text-[9px] font-semibold text-muted"
            >
              {g}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function Panel({
  caption,
  note,
  delay,
  hold,
  reduced,
  className,
  children,
}: {
  caption: string
  note: string
  delay: number
  hold: boolean
  reduced: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <figure
      className="flex flex-1 flex-col gap-2 text-left"
      style={
        reduced
          ? undefined
          : hold
            ? { opacity: 0 }
            : { animation: `panelIn 620ms ${delay}ms var(--ease-sl) both` }
      }
    >
      <div className={cn('px-3.5 py-3', className)}>{children}</div>
      <figcaption className="px-1">
        <span className="block text-[12.5px] font-semibold text-ink-3">{caption}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-muted">{note}</span>
      </figcaption>
    </figure>
  )
}

/** A line of type, stood in for. Never text — this is a diagram, not a mock. */
function Rule({ w, tone }: { w: string; tone?: 'bright' }) {
  return (
    <span
      className={cn('block h-[5px] rounded-full', tone === 'bright' ? 'bg-ink-3/45' : 'bg-line')}
      style={{ width: w }}
    />
  )
}

/**
 * The hand-off itself.
 *
 * Drawn as a line that grows toward the next panel, because the claim being
 * made is that the material *becomes* the answer and the answer *becomes* the
 * card. An arrow between two static boxes would say "and also"; a line that
 * travels says "from this".
 */
function Connector({
  delay,
  hold,
  reduced,
}: {
  delay: number
  hold: boolean
  reduced: boolean
}) {
  const anim = (name: string, d: number) =>
    reduced ? undefined : hold ? { opacity: 0 } : { animation: `${name} 470ms ${d}ms var(--ease-sl) both` }
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center self-center py-1 sm:py-0"
      style={anim('stepIn', delay)}
    >
      <span
        className={cn(
          'block origin-top bg-gradient-to-b from-line to-brand/50 sm:origin-left sm:bg-gradient-to-r',
          'h-6 w-px sm:h-px sm:w-8',
        )}
        style={anim('drawLine', delay + 60)}
      />
      <Icon
        name="arrowRight"
        size={11}
        className="ml-[-3px] rotate-90 text-brand/70 sm:ml-0 sm:rotate-0"
      />
    </div>
  )
}

/* ── The surfaces ─────────────────────────────────────────────────────── */

const SURFACES: { icon: IconName; name: string; what: string; tone: string }[] = [
  {
    icon: 'chat',
    name: 'Chat',
    what: 'Ask about your material. Answers cite the page, and the conversation is what every agent works from.',
    tone: 'text-brand',
  },
  {
    icon: 'doc',
    name: 'Sources',
    what: 'PDFs and pasted notes, split and indexed on upload so retrieval can find the right passage.',
    tone: 'text-sky',
  },
  {
    icon: 'note',
    name: 'Notes',
    what: 'A real editor — headings, tables, images, code. Type / to ask the tutor mid-sentence and keep the citation.',
    tone: 'text-ink-3',
  },
  {
    icon: 'deck',
    name: 'Flashcards',
    what: 'Spaced repetition. Grade a card and it comes back when you are about to forget it, not on a fixed rota.',
    tone: 'text-sun',
  },
  {
    icon: 'quiz',
    name: 'Quizzes',
    what: 'Scored, with the weak subtopics named — so the next session has somewhere obvious to start.',
    tone: 'text-coral',
  },
]

/**
 * What is actually in here.
 *
 * A list on a rule rather than a grid of matching cards: these are five
 * different things, and rendering them as five identical tiles is the pattern
 * that makes every product's feature section look the same. The rule gives them
 * a spine; the icon and the name carry the difference.
 */
function Surfaces({ reveal, reduced }: { reveal: boolean; reduced: boolean }) {
  return (
    <div className="mt-16 w-full max-w-3xl text-left">
      <h2 className="nameplate text-[19px] text-ink-3">What's inside a topic</h2>
      <ul className="mt-4 flex flex-col">
        {SURFACES.map((s, i) => (
          <li
            key={s.name}
            className="flex gap-3.5 border-t border-line py-3.5 last:border-b"
            style={
              reduced
                ? undefined
                : !reveal
                  ? { opacity: 0 }
                  : { animation: `stepIn 500ms ${1320 + i * 90}ms var(--ease-sl) both` }
            }
          >
            <Icon name={s.icon} size={16} className={cn('mt-0.5 shrink-0', s.tone)} />
            <div className="min-w-0">
              <span className="block text-[14.5px] font-semibold text-ink">{s.name}</span>
              <span className="mt-0.5 block text-[13.5px] leading-relaxed text-muted">
                {s.what}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Skills vs Agents ─────────────────────────────────────────────────── */

/**
 * The one distinction the product cannot afford to collapse.
 *
 * A Skill changes *how the AI talks* and stays on until you turn it off; an
 * Agent *makes you something* and is finished. Both are "AI features", which is
 * exactly why they blur — so they are shown as a contrast, side by side, rather
 * than as two more entries in the list above.
 */
function TwoKinds({ reveal, reduced }: { reveal: boolean; reduced: boolean }) {
  const at = (n: number) =>
    reduced
      ? undefined
      : !reveal
        ? { opacity: 0 }
        : { animation: `stepIn 520ms ${n}ms var(--ease-sl) both` }

  return (
    <div className="mt-14 w-full max-w-3xl text-left" style={at(1800)}>
      <h2 className="nameplate text-[19px] text-ink-3">Two kinds of AI in here</h2>
      <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <div>
          <div className="flex items-center gap-2">
            <Icon name="skill" size={14} className="text-mint" />
            <span className="text-[14.5px] font-semibold text-ink">Skills</span>
          </div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
            Change <em className="not-italic text-ink-3">how the tutor talks</em>, and
            stay on until you switch them off. Socratic Tutor refuses to hand you
            the answer. Cite Everything won't make an uncited claim.
          </p>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <Icon name="agent" size={14} filled className="text-brand" />
            <span className="text-[14.5px] font-semibold text-ink">Agents</span>
          </div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
            <em className="not-italic text-ink-3">Make you something</em> from the
            conversation you just had — a note, a deck, a quiz — and then they're
            done. One tap, one artifact.
          </p>
        </div>
      </div>
    </div>
  )
}
