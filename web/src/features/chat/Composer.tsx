import { useEffect, useRef, useState } from 'react'
import { AttachmentStrip, AttachmentViewer, useAttachments } from './Attachments'
import { LIMITS } from '../../lib/limits'
import type { AgentKey } from './agents'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { useAssessment } from '../../lib/assessment'
import './chat.css'

/**
 * Typed shortcuts. Recognised, not advertised here.
 *
 * The chip row that used to sit under the input showed `/notes /quiz
 * /flashcards` permanently — three buttons duplicating the "Do something with
 * this" panel already open on the right, and a row of syntax under an input
 * box reads as an instruction manual. Typing them still works for anyone who
 * knows them; discovery happens in the dock at `lg:` and up, and in
 * `ContextDock`'s `ActiveAgentsStrip` below it — not here, so this file never
 * grows a second copy of that list.
 */
const slashCommands: { command: string; agent: AgentKey; does: string }[] = [
  { command: '/notes', agent: 'notes', does: 'Write a note from your files' },
  { command: '/quiz', agent: 'quiz', does: 'Make a quiz to test yourself' },
  { command: '/flashcards', agent: 'flashcards', does: 'Make flashcards to review' },
]

/** What is asked when an image is sent with no words. The API needs some text,
 *  and the bubble shows this, so the student sees what was asked. */
export const IMAGE_ONLY_QUESTION = 'What does this show?'

/** What was typed and not sent, per topic. The chat is remounted on a topic
 *  switch, which used to throw a half-written question away. Kept for this
 *  tab only; storage can be blocked, and then a draft simply is not kept. */
const drafts = {
  get(key: string): string {
    try {
      return sessionStorage.getItem(`sl:chat-draft:${key}`) ?? ''
    } catch {
      return ''
    }
  },
  set(key: string, text: string) {
    try {
      if (text) sessionStorage.setItem(`sl:chat-draft:${key}`, text)
      else sessionStorage.removeItem(`sl:chat-draft:${key}`)
    } catch {
      // Nothing to do: the question is still in the box.
    }
  },
}

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
  suggestion,
  examples,
  notice,
  draftKey,
  scope,
  onScope,
}: {
  placeholder: string
  disabled?: boolean
  streaming?: boolean
  /** Resolving to `false` means the question was not taken: the composer puts it back. */
  onSend: (text: string, opts?: { images?: string[] }) => void | boolean | Promise<boolean | void>
  onCancel?: () => void
  onRunAgent: (agent: AgentKey, argument?: string) => void
  /** One question to offer while the box is empty, shown where the text will go. → fills it in; sending stays the student's call. */
  suggestion?: string
  /** Questions to start from, as buttons above the box. Tapping one fills the box. */
  examples?: string[]
  /** One quiet line above the box (a file still being read). */
  notice?: string
  /** Keeps a typed, unsent question for this key (the topic) across a switch. */
  draftKey?: string
  /** How strictly answers stick to the files in this topic; shown as a toggle when given. */
  scope?: 'files' | 'subject'
  onScope?: (scope: 'files' | 'subject') => void
}) {
  const [value, setValue] = useState(() => (draftKey ? drafts.get(draftKey) : ''))
  useEffect(() => {
    if (draftKey) drafts.set(draftKey, value)
  }, [draftKey, value])
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const shots = useAttachments()

  // Auto-grow the textarea to a maximum height then scroll.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(180, el.scrollHeight)}px`
  }, [value])

  /* The command menu: `/` and nothing after it yet but letters. It narrows as
     the command is typed and goes once there is a space (the topic follows). */
  const [menuAt, setMenuAt] = useState(0)
  const [menuClosedFor, setMenuClosedFor] = useState<string | null>(null)
  const menu =
    /^\/\S*$/.test(value) && menuClosedFor !== value
      ? slashCommands.filter((c) => c.command.startsWith(value.toLowerCase()))
      : []
  const menuIndex = Math.min(menuAt, Math.max(0, menu.length - 1))
  const pick = (command: string) => {
    // With a space after it: the menu closes and a topic can be typed, or Enter runs it.
    setValue(`${command} `)
    setMenuAt(0)
    ref.current?.focus()
  }

  const submit = () => {
    const typed = value.trim()
    // An image on its own is a question too.
    const text = typed || (shots.items.length > 0 ? IMAGE_ONLY_QUESTION : '')
    if (!text) return
    // A whole word: "/quizzes are hard" is a question, not the quiz command.
    const match = slashCommands.find((c) => text.startsWith(c.command) && /^(\s|$)/.test(text.slice(c.command.length)))
    if (match) {
      const argument = text.slice(match.command.length).trim()
      onRunAgent(match.agent, argument || undefined)
      setValue('')
      shots.clear()
      return
    }
    // One answer at a time. Enter used to send a second question while the
    // first was still arriving (only the button was swapped for Stop), and the
    // two streams then wrote over each other. What is typed stays in the box.
    if (streaming) return
    const images = shots.items
    const sent = onSend(text, { images: images.map((i) => i.url) })
    setValue('')
    shots.clear()
    // Not taken (out of answers for today, offline, refused): the question
    // comes back to be sent again rather than being lost with the error.
    void Promise.resolve(sent).then((ok) => {
      if (ok !== false) return
      setValue((now) => now || typed)
      shots.restore(images)
    })
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
  /** The offer shows in the box itself, in the placeholder's place, while it is empty. */
  const offer = suggestion && !streaming && !disabled && !assessing && shots.items.length === 0 ? suggestion : null
  const canSend = !disabled && !assessing && (value.trim().length > 0 || shots.items.length > 0)

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

      <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-2 px-5 pb-3 pt-1">
        {examples && examples.length > 0 && !value && !assessing && !streaming && (
          <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Questions to start with">
            {examples.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setValue(q)
                  ref.current?.focus()
                }}
                className="min-h-9 cursor-pointer rounded-full border border-line bg-raised px-3.5 py-1.5 text-[13.5px] text-ink-2 transition-colors hover:border-ink-3/60 hover:text-ink"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {notice && (
          <p role="status" className="text-center text-[12.5px] leading-snug text-muted">
            {notice}
          </p>
        )}
        {menu.length > 0 && !assessing && (
          <ul
            id="chat-commands"
            role="listbox"
            aria-label="Commands"
            className="absolute inset-x-5 bottom-full z-10 mb-1 flex flex-col overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lg"
          >
            {menu.map((c, i) => (
              <li
                key={c.command}
                id={`chat-command-${c.agent}`}
                role="option"
                aria-selected={i === menuIndex}
                // `mousedown`, so the box keeps its focus.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(c.command)
                }}
                onMouseEnter={() => setMenuAt(i)}
                className={cn(
                  'flex min-h-9 cursor-pointer items-baseline gap-3 rounded-lg px-2.5 py-1.5 text-[13.5px]',
                  i === menuIndex ? 'bg-line-soft text-ink' : 'text-ink-2',
                )}
              >
                <span className="w-24 shrink-0 font-mono text-[12.5px] font-semibold">{c.command}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{c.does}</span>
              </li>
            ))}
          </ul>
        )}
        <AttachmentStrip
          items={shots.items}
          onRemove={shots.remove}
          onOpen={shots.open}
        />
        <AttachmentViewer item={shots.viewing} onClose={shots.closeViewer} />
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            void shots.add(Array.from(e.target.files ?? []))
            // Cleared so picking the same file twice in a row still fires
            // `change` — otherwise re-attaching something you just removed
            // silently does nothing.
            e.target.value = ''
          }}
        />
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
            data-chat-input
            rows={1}
            /* Stops at the API's own ceiling rather than letting a long paste
               become a validation error. See lib/limits.ts. */
            maxLength={LIMITS.chatText}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setMenuAt(0)
              setMenuClosedFor(null)
            }}
            aria-controls={menu.length > 0 ? 'chat-commands' : undefined}
            aria-activedescendant={menu.length > 0 ? `chat-command-${menu[menuIndex].agent}` : undefined}
            /* Paste is the whole feature. A student takes a screenshot of a
               slide or a problem set and hits Ctrl+V — asking them to save it
               to disk first and then find it in a picker is the interaction
               this replaces. `getAsFile` returns null for ordinary text
               pastes, so those fall through to the textarea untouched. */
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files)
              if (files.length === 0) return
              e.preventDefault()
              void shots.add(files)
            }}
            onKeyDown={(e) => {
              if (menu.length > 0) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const step = e.key === 'ArrowDown' ? 1 : -1
                  setMenuAt((menuIndex + step + menu.length) % menu.length)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setMenuClosedFor(value)
                  return
                }
                // A command typed out in full runs on Enter, as it always has.
                const whole = menu.some((c) => c.command === value.toLowerCase())
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !whole)) {
                  e.preventDefault()
                  pick(menu[menuIndex].command)
                  return
                }
              }
              // → takes the offered question into the box, like accepting a completion.
              if (e.key === 'ArrowRight' && offer && !value) {
                e.preventDefault()
                setValue(offer)
                return
              }
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
                : shots.items.length > 0
                  ? 'Ask about this image, or just send it'
                  : (offer ?? placeholder)
            }
            disabled={disabled || assessing}
            className="min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[16px] leading-[1.5] text-ink outline-none placeholder:text-faint disabled:opacity-60"
          />

          {/* The → key, drawn as a key. Without it the offer looked like any
              other placeholder and nobody knew it could be taken. Neutral on
              purpose: the one orange thing in this row is Send. */}
          {offer && !value && (
            <button
              type="button"
              onClick={() => {
                setValue(offer)
                ref.current?.focus()
              }}
              aria-label="Use this suggestion"
              title="Use this suggestion (→)"
              className="mb-1 grid h-6 w-7 shrink-0 cursor-pointer place-items-center rounded-md border border-line border-b-2 bg-canvas text-muted t-control duration-200 hover:border-muted hover:text-ink"
            >
              <Icon name="arrowRight" size={13} />
            </button>
          )}

          {/* This topic's strictness, one tap to switch. Off-topic questions
              are declined either way; this only decides whether general
              knowledge of the subject may fill gaps in the files. */}
          {scope && onScope && !assessing && (
            <button
              type="button"
              onClick={() => onScope(scope === 'files' ? 'subject' : 'files')}
              aria-pressed={scope === 'files'}
              aria-label={
                scope === 'files'
                  ? 'Answers use only your files. Switch to files plus subject knowledge'
                  : 'Answers use your files plus subject knowledge. Switch to only your files'
              }
              title={
                scope === 'files'
                  ? 'Only your files — says so when they don’t cover it. Click to also allow general knowledge of this subject.'
                  : 'Your files first, then general knowledge of this subject (marked as such). Click for files only.'
              }
              className={cn(
                'mb-0.5 flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-semibold',
                't-control duration-200',
                scope === 'files'
                  ? 'border-sky/40 bg-sky/10 text-ink-2 hover:border-sky/70'
                  : 'border-sun/40 bg-sun/10 text-ink-2 hover:border-sun/70',
              )}
            >
              <Icon name={scope === 'files' ? 'doc' : 'book'} size={13} />
              <span className="hidden sm:inline">{scope === 'files' ? 'My files only' : 'Files + subject'}</span>
            </button>
          )}

          {/* Paste is the fast path; this is the discoverable one. Nobody
              learns Ctrl+V works by guessing, and on a phone there is no
              paste gesture for a screenshot at all. Hidden while a review is
              running, for the same reason the input is locked. */}
          {!assessing && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || shots.items.length >= LIMITS.chatImages}
              aria-label="Attach an image"
              title={
                shots.items.length >= LIMITS.chatImages
                  ? `${LIMITS.chatImages} images is the limit`
                  : 'Attach an image'
              }
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-full',
                't-control duration-200',
                shots.items.length >= LIMITS.chatImages
                  ? 'cursor-default text-faint'
                  : 'cursor-pointer text-muted hover:bg-line-soft hover:text-ink',
              )}
            >
              <Icon name="upload" size={14} />
            </button>
          )}

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
                't-control duration-200 cursor-pointer',
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
        <p className="text-center text-[12px] leading-none text-faint">
          Answers can be wrong. Check anything that matters against your sources.
        </p>
      </div>
    </div>
  )
}
