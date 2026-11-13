import { useState, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

/**
 * A password box with a Show button, so a typo can be seen before it is sent.
 *
 * Looks the same as `ui/Input`; the field is drawn here because the button
 * has to sit inside the box, which `Input` has no slot for. The button keeps
 * one name ("Show password") and says whether it is on with `aria-pressed`.
 */
export function PasswordField({
  name,
  label,
  error,
  hint,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'name'> & {
  name: string
  label: string
  error?: string
  hint?: string
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="setcode">
        {label}
      </label>
      <div className="relative flex">
        <input
          id={name}
          name={name}
          {...rest}
          type={shown ? 'text' : 'password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            'w-full rounded-[11px] border bg-well py-3 pl-3.5 pr-16 text-sm text-ink outline-none transition-colors placeholder:text-faint',
            'focus:outline-none',
            error
              ? 'border-coral focus:border-coral focus:ring-2 focus:ring-coral/25'
              : 'border-line focus:border-brand focus:ring-2 focus:ring-brand/25',
            className,
          )}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${name}-err` : undefined}
        />
        <button
          type="button"
          onClick={() => setShown((on) => !on)}
          aria-pressed={shown}
          aria-label={`Show ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-0 min-w-14 cursor-pointer rounded-r-[11px] px-3 text-[12.5px] font-semibold text-muted transition-colors hover:text-ink"
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {error ? (
        <p id={`${name}-err`} className="text-[12.5px] font-semibold text-coral-deep">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-faint">{hint}</p>
      ) : null}
    </div>
  )
}
