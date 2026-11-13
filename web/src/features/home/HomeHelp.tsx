/**
 * Help, from Home.
 *
 * Not a copy of the chat dock's Help (that one answers "what's wrong with this
 * chat"). From Home the questions are wider: how do I start, what is each part
 * of the app for and where is it, which keys work, and what to do when
 * something is stuck. Every line is a fact about how the app behaves today —
 * when one changes, change it here too.
 *
 * Discoverable without nagging: the button sits at the top of Home (and `?`
 * opens it on a keyboard), and a one-line offer appears only while an account
 * is still getting set up, dismissible for good.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { cn } from '../../lib/cn'
import { useIsMobile } from '../../lib/useIsMobile'
import { Shortcuts } from '../settings/Shortcuts'
import { trustOverlayHref } from '../trust/TrustLayer'

// ── Open/close ─────────────────────────────────────────────────────────

/**
 * One dialog per page, opened from any of its triggers. Open for one history
 * entry only: following a link inside it closes it instead of leaving it over
 * the new page.
 */
export function useHomeHelp({ hasTopics = true, keyboard = false }: { hasTopics?: boolean; keyboard?: boolean } = {}) {
  const location = useLocation()
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = useCallback(() => setOpenAt(location.key), [location.key])

  // `?` opens Help — but never while typing, with a modifier held, or over
  // another dialog.
  useEffect(() => {
    if (!keyboard) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      open()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard, open])

  const dialog = (
    <Modal open={openAt === location.key} onClose={() => setOpenAt(null)} title="Help" width="lg">
      <HelpContent hasTopics={hasTopics} />
    </Modal>
  )
  return { open, dialog }
}

/** The quiet top-of-page button. */
export function HelpButton({ onOpen, className, hint = false }: { onOpen: () => void; className?: string; hint?: boolean }) {
  return (
    <Button variant="ghost" size="sm" className={className} onClick={onOpen} aria-label="Help" title={hint ? 'Help (press ?)' : 'Help'}>
      <Icon name="help" size={14} /> Help
      {hint && <Kbd className="ml-0.5">?</Kbd>}
    </Button>
  )
}

/** Button and dialog together, for a page that needs nothing more. */
export function HomeHelp({ className, hasTopics = true }: { className?: string; hasTopics?: boolean }) {
  const phone = useIsMobile()
  const { open, dialog } = useHomeHelp({ hasTopics, keyboard: !phone })
  return (
    <>
      <HelpButton onOpen={open} className={className} hint={!phone} />
      {dialog}
    </>
  )
}

const NUDGE_KEY = 'sl:home-help-nudge:v1'

/**
 * The one-time offer, for an account still getting set up. Opening Help or
 * dismissing it puts it away for good on this device.
 */
export function HelpNudge({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const [gone, setGone] = useState(true)
  useEffect(() => {
    try {
      setGone(localStorage.getItem(NUDGE_KEY) === '1')
    } catch {
      setGone(false)
    }
  }, [])
  if (gone) return null
  const done = () => {
    setGone(true)
    try {
      localStorage.setItem(NUDGE_KEY, '1')
    } catch {
      /* private mode — it shows again next visit */
    }
  }
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border border-line bg-well/60 px-3.5 py-2.5', className)}>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-soft text-sky-deep" aria-hidden>
        <Icon name="help" size={15} />
      </span>
      <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-muted">
        New here? Help shows what each part of Space Learn does and how to start.
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0"
        onClick={() => {
          done()
          onOpen()
        }}
      >
        Show me
      </Button>
      <button
        type="button"
        onClick={done}
        aria-label="Dismiss"
        className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md text-faint transition-colors hover:bg-line-soft hover:text-ink-3"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}

// ── The words ──────────────────────────────────────────────────────────

type Part = { icon: IconName; title: string; body: string; to?: string; needsTopic?: boolean }

const START_DESKTOP: { title: string; body: string }[] = [
  { title: 'Make a subject', body: 'Press + beside Subjects in the sidebar. A subject is a course, like Biology; topics are its parts.' },
  { title: 'Add your files', body: 'Open a topic, then Files. A PDF, slides, your notes or a photo of a page. They’re ready to ask about in a minute or two.' },
  { title: 'Ask, then practise', body: 'Ask in the topic’s chat — answers cite the page. Then turn it into a note, flashcards or a quiz.' },
]

const START_PHONE: { title: string; body: string }[] = [
  { title: 'Make a subject and topic', body: 'On Today, or from the topic button at the top of the screen.' },
  { title: 'Add material', body: 'A photo of your notes or a file, into the topic.' },
  { title: 'Revise', body: 'Cards, Quizzes and Notes are in the tabs at the bottom. The chat tutor is on a computer.' },
]

const PARTS_DESKTOP: Part[] = [
  { icon: 'home', title: 'Home', body: 'What to do now, your subjects, and how your week went.', to: '/home' },
  { icon: 'book', title: 'Subjects and topics', body: 'In the sidebar. A topic opens on its chat, with Files, Notes, Quizzes and Cards beside it.' },
  { icon: 'chat', title: 'Chat tutor', body: 'Answers only from your files, and shows the page each answer came from.' },
  { icon: 'note', title: 'Notes', body: 'Every note from every topic. Write your own or make one from a chat.', to: '/notes', needsTopic: true },
  { icon: 'deck', title: 'Cards', body: 'Flashcards that come back on a schedule, so you review what you’re about to forget.', to: '/flashcards', needsTopic: true },
  { icon: 'quiz', title: 'Quizzes', body: 'Practice tests from your material. Retake the ones you scored lowest on.', to: '/quizzes', needsTopic: true },
  { icon: 'skill', title: 'Skills', body: 'Change how the tutor explains things. A skill stays on until you turn it off.', to: '/skills' },
  { icon: 'user', title: 'Profile and Settings', body: 'Your record and what to focus on; goals, privacy and feedback in Settings.', to: '/profile' },
]

const PARTS_PHONE: Part[] = [
  { icon: 'home', title: 'Today', body: 'The one thing worth doing now, then your topics and your week.', to: '/home' },
  { icon: 'deck', title: 'Cards', body: 'Review what’s due. Cards come back on a schedule.', to: '/flashcards', needsTopic: true },
  { icon: 'quiz', title: 'Quizzes', body: 'Practice tests from your material.', to: '/quizzes', needsTopic: true },
  { icon: 'note', title: 'Notes', body: 'Read your notes from every topic.', to: '/notes', needsTopic: true },
  { icon: 'user', title: 'You', body: 'Your record, and Settings.', to: '/profile' },
  { icon: 'book', title: 'The topic button', body: 'At the top of the screen: switch topic, or add a topic or subject.' },
]

const FIXES: { problem: string; fix: string }[] = [
  {
    problem: 'Home takes a long time to load',
    fix: 'The server sleeps when nobody has used it for a while and can take up to a minute to wake. Your things are safe; it loads on its own.',
  },
  {
    problem: 'My file is stuck on “Reading…”',
    fix: 'Big or scanned files take a minute or two. If it says it couldn’t read it, press Try again.',
  },
  {
    problem: 'The tutor says it can’t find the answer',
    fix: 'It only answers from your files. Check your file says Ready, or add the one that covers it.',
  },
  {
    problem: 'It says the AI is at capacity',
    fix: 'Too many people are asking at once. Wait a minute and ask again.',
  },
]

function HelpContent({ hasTopics }: { hasTopics: boolean }) {
  const phone = useIsMobile()
  const location = useLocation()
  const start = phone ? START_PHONE : START_DESKTOP
  const parts = phone ? PARTS_PHONE : PARTS_DESKTOP
  return (
    <div className="flex flex-col gap-7">
      <Section id="help-start" title="Start here">
        <ol className="flex flex-col gap-2">
          {start.map((s, i) => (
            <li key={s.title} className="flex items-start gap-3">
              <span
                aria-hidden
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-brand/50 bg-brand-tint text-[13px] font-bold tabular-nums text-brand-deep"
              >
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-[14px] font-semibold text-ink">{s.title}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="help-where" title="What’s where">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {parts.map((p) => {
            const body = (
              <>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-raised text-ink-3" aria-hidden>
                  <Icon name={p.icon} size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ink">{p.title}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{p.body}</span>
                </span>
              </>
            )
            const live = p.to && (!p.needsTopic || hasTopics)
            return (
              <li key={p.title}>
                {live ? (
                  <Link
                    to={p.to!}
                    className="flex min-h-11 items-start gap-2.5 rounded-[10px] border border-line px-3 py-2.5 transition-colors hover:border-brand/40 hover:bg-line-soft"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-2.5 rounded-[10px] border border-line-soft px-3 py-2.5">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      </Section>

      {!phone && (
        <Section id="help-keys" title="Keyboard">
          <p className="text-[13px] leading-relaxed text-muted">
            <Kbd>?</Kbd> opens this help from Home. In a topic’s chat, type <Kbd>/notes</Kbd>, <Kbd>/quiz</Kbd> or{' '}
            <Kbd>/flashcards</Kbd> to make one fast.
          </p>
          <Shortcuts />
        </Section>
      )}

      <Section id="help-fixes" title="If something’s wrong">
        <div className="flex flex-col gap-1.5">
          {FIXES.map((f) => (
            <details key={f.problem} className="group rounded-[10px] border border-line">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                <span className="flex-1 leading-snug">{f.problem}</span>
                <Icon name="chevronDown" size={14} className="shrink-0 text-faint transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <p className="px-3 pb-3 text-[12.5px] leading-snug text-muted">{f.fix}</p>
            </details>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            to={trustOverlayHref(location, 'privacy')}
            className="flex min-h-11 items-center gap-2 rounded-[10px] border border-line px-3 text-[13px] font-semibold text-ink-2 transition-colors hover:border-brand/40 hover:text-ink"
          >
            <Icon name="lock" size={14} /> How your files are used
          </Link>
          <Link
            to="/settings?section=feedback"
            className="flex min-h-11 items-center gap-2 rounded-[10px] border border-line px-3 text-[13px] font-semibold text-ink-2 transition-colors hover:border-brand/40 hover:text-ink"
          >
            <Icon name="send" size={14} /> Tell us what went wrong
          </Link>
        </div>
      </Section>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <h3 id={id} className="setcode-strong">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd className={cn('rounded-[5px] border border-line bg-raised px-1.5 py-px font-mono text-[11px] text-ink-2', className)}>
      {children}
    </kbd>
  )
}
