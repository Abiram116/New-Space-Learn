import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'dark' | 'soft' | 'ghost'
type Size = 'sm' | 'md'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand/90',
  secondary: 'border-[1.5px] border-line bg-surface text-ink hover:border-brand-200',
  dark: 'bg-ink text-white hover:bg-ink/90',
  soft: 'bg-brand-soft text-brand hover:bg-brand-200/60',
  ghost: 'text-muted hover:bg-line-soft',
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-[9px]',
  md: 'px-4 py-2.5 text-[13px] rounded-[11px]',
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: Props) {
  return (
    <button
      className={cn(
        'font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}
