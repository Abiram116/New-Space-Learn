import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

/**
 * Printed cardstock: a light top edge, a contact shadow, and a soft drop.
 * `foil` adds the angled iridescent sweep on hover — reserve it for cards that
 * are actually earned or actually due, never as default decoration.
 */
export function Card({
  className,
  foil = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { foil?: boolean }) {
  return (
    <div
      className={cn('cardstock rounded-xl', foil && 'foil', className)}
      {...props}
    />
  )
}

/** An empty slot in the binder — where a card could go but none is yet. */
export function DashedCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-line-dash bg-well/40 text-muted',
        className,
      )}
      {...props}
    />
  )
}
