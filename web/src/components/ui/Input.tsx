import { useId, type InputHTMLAttributes, type Ref, type TextareaHTMLAttributes } from 'react'
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
  // A field given neither an id nor a name still needs one, or its label is
  // loose text beside an unnamed box and the error below is never announced.
  const fallbackId = useId()
  const inputId = id ?? rest.name ?? fallbackId
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
        aria-describedby={error ? `${inputId}-err` : rest['aria-describedby']}
      />
      {error ? (
        <p id={`${inputId}-err`} className="text-[12.5px] font-semibold text-coral-deep">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-faint">{hint}</p>
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
  ref,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & Common & { ref?: Ref<HTMLTextAreaElement> }) {
  const fallbackId = useId()
  const inputId = id ?? rest.name ?? fallbackId
  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="setcode">
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        ref={ref}
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
        aria-describedby={error ? `${inputId}-err` : rest['aria-describedby']}
      />
      {error ? (
        <p id={`${inputId}-err`} className="text-[12.5px] font-semibold text-coral-deep">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-faint">{hint}</p>
      ) : null}
    </div>
  )
}
