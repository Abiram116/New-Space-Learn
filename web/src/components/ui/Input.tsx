import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Common = {
  label?: string
  error?: string | null
  hint?: string
  containerClassName?: string
}

export function Input({
  label,
  error,
  hint,
  containerClassName,
  className,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & Common) {
  const inputId = id ?? rest.name
  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-muted">
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...rest}
        className={cn(
          'rounded-xl border-[1.5px] bg-surface px-3.5 py-3 text-sm outline-none placeholder:text-faint',
          error
            ? 'border-coral-deep focus:ring-4 focus:ring-coral-soft'
            : 'border-line focus:border-brand focus:ring-4 focus:ring-brand-soft',
          className,
        )}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error && inputId ? `${inputId}-err` : undefined}
      />
      {error ? (
        <p id={inputId ? `${inputId}-err` : undefined} className="text-xs text-coral-deep">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  )
}

export function Textarea({
  label,
  error,
  hint,
  containerClassName,
  className,
  id,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & Common) {
  const inputId = id ?? rest.name
  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-muted">
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        {...rest}
        className={cn(
          'resize-y rounded-xl border-[1.5px] bg-surface px-3.5 py-3 text-sm leading-relaxed outline-none placeholder:text-faint',
          error
            ? 'border-coral-deep focus:ring-4 focus:ring-coral-soft'
            : 'border-line focus:border-brand focus:ring-4 focus:ring-brand-soft',
          className,
        )}
        aria-invalid={Boolean(error) || undefined}
      />
      {error ? (
        <p className="text-xs text-coral-deep">{error}</p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  )
}
