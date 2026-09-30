import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'

/** The drafting-table role colours, for a row's icon tile. */
export type RowRole = 'recall' | 'test' | 'read' | 'source'

const ROLE: Record<RowRole, string> = {
  recall: 'bg-sun-soft text-sun', // cards — amber is recall/due
  test: 'bg-coral-soft text-coral-deep', // quizzes — magenta is scoring
  read: 'bg-azure-soft text-azure-deep', // notes — blueprint linework
  source: 'bg-sky-soft text-sky', // sources — cyan is evidence
}

/**
 * One tappable row in a phone list: icon tile, label, optional detail line,
 * optional count, chevron. 56px+ tall, the whole row is the target.
 */
export function MobileRow({
  to,
  icon,
  role,
  label,
  detail,
  count,
}: {
  to: string
  icon: IconName
  role: RowRole
  label: string
  detail?: ReactNode
  count?: number | null
}) {
  return (
    <Link
      to={to}
      className="t-control flex min-h-[60px] items-center gap-3.5 px-4 py-2.5 active:bg-line-soft"
    >
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', ROLE[role])} aria-hidden>
        <Icon name={icon} size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold text-ink">{label}</span>
        {detail && <span className="mt-0.5 block truncate text-[13px] text-faint">{detail}</span>}
      </span>
      {typeof count === 'number' && (
        <span className="shrink-0 font-mono text-[14px] font-medium tabular-nums text-muted">{count}</span>
      )}
      <Icon name="chevronRight" size={17} className="shrink-0 text-faint" />
    </Link>
  )
}

/** A grouped list of rows on one plate, hairlines between. */
export function RowGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <nav aria-label={label} className="overflow-hidden rounded-2xl border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line-soft">
      {children}
    </nav>
  )
}
