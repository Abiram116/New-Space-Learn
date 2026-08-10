import { useEffect, useRef, useState } from 'react'
import type { AgentKey } from './agents'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { useAssessment } from '../../lib/assessment'

/**
 * Typed shortcuts. Recognised, not advertised.
 *
 * The chip row that used to sit under the input showed `/notes /quiz
 * /flashcards` permanently — three buttons duplicating the "Do something with
 * this" panel already open on the right, and a row of syntax under an input
 * box reads as an instruction manual. Typing them still works for anyone who
 * knows them; discovery happens in the dock, where each action explains what
 * it produces.
 */
const slashCommands: { command: string; agent: AgentKey }[] = [
  { command: '/notes', agent: 'notes' },
  { command: '/quiz', agent: 'quiz' },
  { command: '/flashcards', agent: 'flashcards' },
]

/**
 * The composer.
 *
 * **Seamless, not a bar.** It used to sit on `bg-surface` behind a hard
 * `border-t`, which cut a brown strip across the bottom of the page and made
 * the input read as a separate panel bolted underneath the conversation. The
 * background is the page now; what separates the composer from the messages
 * is a short gradient fade, so text scrolls *under* it and disappears rather
 * than stopping at a line. That is the whole difference between a chat that
 * feels like one surface and one that feels like two.
 *
 * The pill carries the weight instead: a real border, a slightly raised fill,
 * and a focus ring. Weight belongs on the thing you interact with, not on the
 * container holding it.
 */
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

  /* Locked while a quiz or card review is running.
     A quiz is only worth anything if the answers came from the student, and
     with the tutor one panel away "what's the answer to this" is a two-second
     detour that makes every score in the app a lie — the student model, the
     brief and the card schedule are all built on these scores being real.
     Framed as an explanation rather than an accusation: a student who does
     this is only cheating their own revision plan, and treating them as a
     suspect for opening a panel is the worse product. */
  const { assessing, reason } = useAssessment()
  const canSend = !disabled && !assessing && value.trim().length > 0

  return (
    <div className="relative shrink-0">
      {/* The fade replaces the border. Messages dissolve into the composer
          instead of being cut off by a rule, which is what makes the page
          read as one continuous surface. `pointer-events-none` so it never
          eats a click meant for the last message underneath it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-canvas to-transparent"
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-5 pb-3 pt-1">
        {/* Locked state lives on the input itself.
            There was a pill above saying "chat pauses during a review" AND a
            placeholder inside saying "paused while you're reviewing" — the
            same sentence twice, stacked, which reads as the UI being anxious
            about it. The brand outline marks the control that is actually
            unavailable, the placeholder explains it, and the lock icon on the
            send button confirms it. One idea, three non-repeating cues. */}
        <div
          className={cn(
            'flex items-end gap-2 rounded-[22px] border px-3.5 py-2.5',
            'transition-[border-color,box-shadow] duration-200',
            assessing
              ? 'border-brand/60 bg-canvas shadow-[0_0_0_3px_rgba(255,90,60,0.12)]'
              : cn(
                  'border-line bg-raised',
                  'focus-within:border-brand/50 focus-within:shadow-[0_0_0_3px_rgba(255,90,60,0.10)]',
                ),
          )}
        >
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
            placeholder={
              assessing
                ? reason === 'quiz'
                  ? 'Paused while you’re taking the quiz'
                  : 'Paused while you’re reviewing cards'
                : placeholder
            }
            disabled={disabled || assessing}
            className="min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-relaxed text-ink outline-none placeholder:text-faint disabled:opacity-60"
          />

          {streaming ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Stop generating"
              title="Stop generating"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-line-soft text-ink transition-colors cursor-pointer hover:bg-line"
            >
              <Icon name="stop" size={13} filled />
            </button>
          ) : (
            /* A round icon button, and it only lights up when there is
               something to send — the old always-brand "Send ↑" pill claimed
               a primary action was available under an empty box. */
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label={assessing ? 'Paused during assessment' : 'Send message'}
              title={assessing ? 'Paused — finish the assessment first' : 'Send'}
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-full',
                'transition-all duration-200 cursor-pointer',
                canSend
                  ? 'bg-brand text-[#1a120f] hover:brightness-110 active:scale-95'
                  : 'cursor-default bg-line-soft text-faint',
                assessing && 'text-brand-deep',
              )}
            >
              <Icon
                name={assessing ? 'lock' : 'arrowRight'}
                size={assessing ? 13 : 15}
                className={assessing ? undefined : '-rotate-90'}
              />
            </button>
          )}
        </div>

        {/* Said once, quietly, where it is read rather than dismissed. The
            product's whole claim is that answers are grounded in the
            student's own material — which makes being honest about the
            failure mode more important here, not less. */}
        <p className="text-center text-[11px] leading-none text-faint">
          Answers can be wrong. Check anything that matters against your sources.
        </p>
      </div>
    </div>
  )
}
