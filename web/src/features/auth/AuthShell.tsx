import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Shared split layout for sign-in and sign-up. Ships a side panel with the
 *  product's calling card so first-time visitors have something to look at. */
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
  return (
    <div className="grid min-h-full bg-canvas text-ink lg:grid-cols-[1.05fr_1fr]">
      <div className="flex flex-col justify-center gap-7 px-8 py-14 sm:px-14">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="h-[30px] w-[30px] rounded-[9px] bg-brand" />
          <span className="font-display text-lg font-semibold">Space Learn</span>
        </Link>
        <div className="flex flex-col gap-2 max-w-100">
          <h1 className="font-display text-[32px] leading-[1.15] font-semibold tracking-[-0.01em]">
            {title}
          </h1>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
        <div className="max-w-100">{children}</div>
        <div className="max-w-100 text-[13px] text-muted">{footer}</div>
      </div>

      <aside className="relative hidden overflow-hidden bg-brand-soft lg:block">
        <div className="absolute inset-0 grid place-items-center p-10">
          <div className="flex max-w-md flex-col gap-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-2xl shadow-[0_8px_24px_rgba(108,92,231,0.14)]">
              ✦
            </div>
            <h2 className="font-display text-2xl font-semibold text-ink">
              A space for every subject.
            </h2>
            <p className="text-sm text-muted">
              Upload your lecture PDFs, ask questions with citations, and turn
              answers into flashcards, notes, and quizzes — one loop per topic.
            </p>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-brand-soft to-transparent" />
      </aside>
    </div>
  )
}
