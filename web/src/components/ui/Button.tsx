import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'dark' | 'soft' | 'ghost' | 'danger' | 'solid3d' | 'outline3d'
type Size = 'sm' | 'md' | 'lg' | 'xl'

/**
 * Buttons are pressed things: each carries a light top edge and sits on its own
 * shadow, and loses ~1px of both on :active so the press is felt rather than
 * just colored.
 */
/**
 * The `outline3d` press physics with no background of its own: a lit top bevel,
 * a 5px base edge, and real travel on :active.
 */
const bevel3d = [
  'shadow-[inset_0_1.5px_0_rgba(255,237,220,0.12),0_5px_0_#191411,0_10px_20px_-8px_rgba(0,0,0,0.8)]',
  'hover:brightness-110',
  'active:translate-y-[5px]',
  'active:shadow-[inset_0_1.5px_0_rgba(255,237,220,0.08),0_0_0_#191411]',
].join(' ')

const variants: Record<Variant, string> = {
  primary:
    'bg-brand text-[#1a120f] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_2px_0_#a8331d,0_6px_14px_-6px_rgba(255,90,60,0.6)] hover:bg-brand-300 active:translate-y-[2px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_0_#a8331d]',
  secondary:
    'border border-line bg-raised text-ink shadow-[inset_0_1px_0_rgba(255,237,220,0.06)] hover:border-line-dash hover:bg-surface active:translate-y-[1px]',
  dark: 'bg-well text-ink border border-line hover:border-line-dash active:translate-y-[1px]',
  soft: 'bg-brand-soft text-brand-deep hover:bg-brand-200/60 active:translate-y-[1px]',
  ghost: 'text-muted hover:bg-line-soft hover:text-ink',
  // The confirm button on every destructive action (`ConfirmDialog`, plus
  // Settings' sign-out/delete-account) hand-rolled this exact treatment via
  // a `className` override on top of `primary` — same string, four places,
  // never through this variant, which sat declared and unused. Consolidated
  // here with zero visual change: `bg-coral-deep` (a light pink — this is a
  // dark-themed app, see index.css) is what all four already rendered, and
  // `#2a1210` is the dark text already paired with coral backgrounds
  // elsewhere (see `QuizRunner.tsx`'s `Choice`) rather than reusing
  // `primary`'s `#1a120f`, which was tuned for the orange brand color.
  danger: 'bg-coral-deep text-[#2a1210] hover:bg-coral-deep/90 active:translate-y-[1px]',

  /* Fully dimensional. A lit top bevel, a shaded face, and a 5px base edge the
     button actually sinks into on press — the travel is real, not a colour
     change. Used where the press is the point: auth, primary CTAs. */
  solid3d: [
    'text-[#1a120f]',
    'bg-[linear-gradient(180deg,#ff8b76_0%,#ff5a3c_46%,#f04a2d_100%)]',
    'shadow-[inset_0_1.5px_0_rgba(255,255,255,0.5),inset_0_-2px_0_rgba(0,0,0,0.18),0_5px_0_#a8331d,0_10px_22px_-6px_rgba(255,90,60,0.55)]',
    'hover:brightness-[1.06]',
    'active:translate-y-[5px]',
    'active:shadow-[inset_0_1.5px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(0,0,0,0.2),0_0_0_#a8331d,0_2px_6px_-2px_rgba(255,90,60,0.4)]',
  ].join(' '),

  /* Same physics in cardstock, for secondary actions that still need weight. */
  outline3d: [
    'text-ink border border-line',
    'bg-[linear-gradient(180deg,#352b24_0%,#2b231d_100%)]',
    'hover:border-line-dash',
    bevel3d,
  ].join(' '),
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-[12px] rounded-[9px]',
  md: 'px-4 py-2.5 text-[13px] rounded-[11px]',
  lg: 'px-5 py-3 text-[14px] rounded-[13px]',
  xl: 'px-6 py-3.5 text-[15px] rounded-[14px]',
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: Props) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-bold t-control duration-100 cursor-pointer',
        'disabled:opacity-40 disabled:cursor-default disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}
