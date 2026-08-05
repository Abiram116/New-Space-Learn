import { useEffect, useRef, useState } from 'react'
import type { AgentKey } from './agents'
import { cn } from '../../lib/cn'

const slashCommands: { command: string; agent: AgentKey; label: string }[] = [
  { command: '/notes', agent: 'notes', label: 'Save notes' },
  { command: '/quiz', agent: 'quiz', label: 'Generate a quiz' },
  { command: '/flashcards', agent: 'flashcards', label: 'Make cards' },
]

export function Composer({
  placeholder,
  disabled,
  streaming,
  onSend,
  onCancel,
  onRunAgent,
}: {
  placeholder: string
  disabled?: boolean
  streaming?: boolean
  onSend: (text: string) => void
  onCancel?: () => void
  onRunAgent: (agent: AgentKey, argument?: string) => void
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  // Auto-grow the textarea to a maximum height then scroll.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(160, el.scrollHeight)}px`
  }, [value])

  const submit = () => {
    const text = value.trim()
    if (!text) return
    const match = slashCommands.find((c) => text.startsWith(c.command))
    if (match) {
      const argument = text.slice(match.command.length).trim()
      onRunAgent(match.agent, argument || undefined)
    } else {
      onSend(text)
    }
    setValue('')
  }

  return (
    <div className="flex shrink-0 flex-col gap-2.5 border-t-[1.5px] border-line bg-surface px-5 py-3.5">
      <div className="flex items-end gap-2.5 rounded-2xl border-[1.5px] border-line px-3.5 py-2.5 focus-within:border-brand-200">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="min-w-0 flex-1 resize-none bg-transparent py-1 text-[13.5px] outline-none placeholder:text-faint disabled:opacity-60"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[9px] bg-line-soft px-3 py-1.5 text-xs font-semibold text-ink cursor-pointer"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim()}
            aria-label="Send message"
            className={cn(
              'rounded-[9px] bg-brand px-3 py-1.5 text-xs font-semibold text-white cursor-pointer',
              'disabled:cursor-default disabled:opacity-40',
            )}
          >
            Send ↑
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
        {slashCommands.map((c) => (
          <button
            key={c.command}
            type="button"
            onClick={() => onRunAgent(c.agent)}
            title={c.label}
            className="rounded-full bg-line-soft px-2.5 py-1 transition-colors hover:bg-brand-soft hover:text-brand cursor-pointer"
          >
            {c.command}
          </button>
        ))}
        <span className="text-faint">← agents live in the composer</span>
      </div>
    </div>
  )
}
