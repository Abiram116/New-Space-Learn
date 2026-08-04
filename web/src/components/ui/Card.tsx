import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border-[1.5px] border-line bg-surface', className)}
      {...props}
    />
  )
}

export function DashedCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border-[1.5px] border-dashed border-line-dash text-muted',
        className,
      )}
      {...props}
    />
  )
}
