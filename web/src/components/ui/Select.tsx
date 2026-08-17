/**
 * A dropdown that actually looks like the rest of the app.
 *
 * A plain `<select>`'s closed state can be themed with CSS; its open
 * popup can't — it's OS/browser chrome (a stark grey list, square corners,
 * no dark mode) that broke the drafting-table look wherever it showed up
 * (the subject filter on Notes/Cards/Quizzes). Same popover shape already
 * used for the slash menu and the "More formatting" panel: an absolutely
 * positioned `rounded-xl border border-line bg-raised` panel, closes on
 * outside click or Escape, selected option in `brand-soft`.
 *
 * Keyboard follows the standard ARIA listbox pattern: Up/Down moves a
 * roving highlight (shown with a ring, kept visually separate from the
 * `brand-soft` *selected* state — they can point at different options),
 * Home/End jump to the ends, Enter/Space commits the highlighted option,
 * Escape or Tab closes without changing anything. Each option is a real
 * `<button>`, so click, native Enter/Space-on-focus, and screen-reader
 * activation all already work without extra wiring — this only adds the
 * roving-highlight layer on top, which is the part a plain list of buttons
 * doesn't get for free.
 */

import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { cn } from '../../lib/cn'

export function Select({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  ariaLabel: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value))

  useEffect(() => {
    if (!open) return
    setActiveIndex(selectedIndex)
    // Moves real DOM focus into the panel so arrow keys land here rather
    // than needing a second, separate listener race with whatever else on
    // the page might also be watching keydown.
    listRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const onListKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
      case 'Tab':
        // Closes rather than tabbing option-by-option — a listbox commits
        // with Enter, it doesn't chain through Tab.
        setOpen(false)
        break
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (options[activeIndex]) {
          onChange(options[activeIndex].value)
          setOpen(false)
        }
        break
    }
  }

  const selected = options.find((o) => o.value === value)

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink-2 outline-none transition-colors cursor-pointer hover:border-line-dash focus:border-brand disabled:cursor-default disabled:opacity-50 disabled:hover:border-line"
      >
        <span className="truncate">{selected?.label ?? ariaLabel}</span>
        <Icon
          name="chevronDown"
          size={12}
          className={cn('shrink-0 text-faint transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="absolute z-30 mt-1 max-h-64 w-full min-w-[10rem] overflow-y-auto rounded-[10px] border border-line bg-raised p-1 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] outline-none"
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center break-words rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors cursor-pointer',
                o.value === value
                  ? 'bg-brand-soft font-semibold text-brand-deep'
                  : 'text-ink-2 hover:bg-line-soft',
                i === activeIndex && 'ring-1 ring-inset ring-brand/40',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
