import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { type IconName } from './Icon'
import { Icon3D } from './Icon3D'

/**
 * An empty binder slot. The dashed frame says "a card goes here", so the copy's
 * job is only to say which card and how to get it.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: IconName
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-dash bg-well/40 px-6 py-14 text-center',
        className,
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-line bg-raised text-brand">
        {/* The largest icon in the product, and the only thing on an empty
            screen — worth the depth. */}
        <Icon3D name={icon} size={20} lifted />
      </span>
      <div className="max-w-sm">
        <h3 className="nameplate text-[19px] text-ink">{title}</h3>
        {description && <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}
