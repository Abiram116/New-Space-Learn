/**
 * Help, in the dock: what Space Learn does, and what to try when it's stuck.
 *
 * Kept short and in everyday words. Three steps say what the app is (people who
 * were sent the link kept asking); a few answers cover what actually goes wrong.
 * Every line is a fact about how the app behaves today — when one changes,
 * change it here too.
 */

import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Icon, type IconName } from '../../components/ui/Icon'
import { trustOverlayHref } from '../trust/TrustLayer'
import { DockAction, DockSectionHead } from './dockParts'

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'upload', title: 'Add your files', body: 'A PDF, your notes, or a photo of a page.' },
  { icon: 'chat', title: 'Ask questions', body: 'Answers come from your files and show the page they came from.' },
  { icon: 'deck', title: 'Practice', body: 'Turn the chat into a note, flashcards or a quiz.' },
]

const FIXES: { problem: string; fix: string }[] = [
  {
    problem: 'It says it can’t find the answer',
    fix: 'I only answer from your files. Check your file says Ready, or add the one that covers it. Scanned PDFs are read up to page 12.',
  },
  {
    problem: 'My file is stuck on “Reading…”',
    fix: 'Big or scanned files take a minute or two. If it says it couldn’t read it, press Try again.',
  },
  {
    problem: 'It says the AI is at capacity',
    fix: 'Too many people are asking at once. Wait a minute and ask again.',
  },
  {
    problem: 'My quiz or cards are about the wrong thing',
    fix: 'They’re made from your files and your chat. Ask about the part you want first, then make them.',
  },
  {
    problem: 'Where did my notes, cards and quizzes go?',
    fix: 'Under “Saved in this topic” in this sidebar. Every topic’s are on the Notes, Cards and Quizzes pages too.',
  },
]

export function DockHelp() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1">
      <section aria-labelledby="help-how" className="flex flex-col gap-2.5">
        <DockSectionHead id="help-how">How it works</DockSectionHead>
        <ol className="flex flex-col gap-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="cardstock flex items-center gap-3 rounded-[12px] px-3 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-deep">
                <Icon name={s.icon} size={17} />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-ink">
                  <span className="mr-1.5 text-[13px] font-semibold tabular-nums text-faint">{i + 1}</span>
                  {s.title}
                </p>
                <p className="mt-0.5 text-[13.5px] leading-snug text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-[13.5px] leading-relaxed text-muted">
          Tip: type <Key>/notes</Key>, <Key>/quiz</Key> or <Key>/flashcards</Key> in the chat to make one fast.
        </p>
      </section>

      <section aria-labelledby="help-fixes" className="flex flex-col gap-2">
        <DockSectionHead id="help-fixes">If something’s wrong</DockSectionHead>
        <div className="flex flex-col gap-1.5">
          {FIXES.map((f) => (
            <details key={f.problem} className="group cardstock rounded-[10px]">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 text-[14.5px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                <span className="flex-1 leading-snug">{f.problem}</span>
                <Icon
                  name="chevronDown"
                  size={14}
                  className="shrink-0 text-faint transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="px-3 pb-3 text-[13.5px] leading-snug text-muted">{f.fix}</p>
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="help-more" className="flex flex-col gap-2">
        <DockSectionHead id="help-more">About your files</DockSectionHead>
        <Link
          to={trustOverlayHref(location, 'privacy')}
          className="flex min-h-11 items-center gap-2.5 rounded-[10px] border border-line bg-raised px-3 py-2 transition-colors hover:border-brand/40"
        >
          <Icon name="lock" size={15} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-ink">How your files are used</span>
            <span className="block text-[13px] text-muted">Privacy, in plain words</span>
          </span>
          <Icon name="chevronRight" size={14} className="shrink-0 text-faint" />
        </Link>
      </section>
      </div>

      <DockAction icon="send" onClick={() => navigate('/settings')}>
        Tell us what went wrong
      </DockAction>
    </div>
  )
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded-[5px] border border-line bg-raised px-1.5 py-px font-mono text-[11px] text-ink-2">
      {children}
    </kbd>
  )
}
