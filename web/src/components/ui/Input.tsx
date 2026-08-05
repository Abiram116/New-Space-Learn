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
        <label htmlFor={inputId} className="setcode">
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...rest}
        className={cn(
          'rounded-[11px] border bg-well px-3.5 py-3 text-sm text-ink outline-none transition-colors placeholder:text-faint',
          'focus:outline-none',
          error
            ? 'border-coral focus:border-coral focus:ring-2 focus:ring-coral/25'
            : 'border-line focus:border-brand focus:ring-2 focus:ring-brand/25',
          className,
        )}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error && inputId ? `${inputId}-err` : undefined}
      />
      {error ? (
        <p id={inputId ? `${inputId}-err` : undefined} className="text-xs font-semibold text-coral-deep">
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
        <label htmlFor={inputId} className="setcode">
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        {...rest}
        className={cn(
          'resize-y rounded-[11px] border bg-well px-3.5 py-3 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-faint',
          'focus:outline-none',
          error
            ? 'border-coral focus:border-coral focus:ring-2 focus:ring-coral/25'
            : 'border-line focus:border-brand focus:ring-2 focus:ring-brand/25',
          className,
        )}
        aria-invalid={Boolean(error) || undefined}
      />
      {error ? (
        <p className="text-xs font-semibold text-coral-deep">{error}</p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  )
}
