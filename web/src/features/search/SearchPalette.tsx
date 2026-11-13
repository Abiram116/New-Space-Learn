/**
 * One box that searches everything the student has: topics, subjects, notes,
 * cards, quizzes, files and the text inside them.
 *
 * Opens on Ctrl+K / ⌘K anywhere in the signed-in app, and on the window event
 * `sl:open-search` (the sidebar and phone top bar buttons dispatch it). Mounted
 * once, in `AppShell`, inside the spaces provider so a hit's topic resolves to
 * its readable address.
 *
 * Keyboard: the input keeps focus the whole time and the list is an ARIA
 * listbox driven by `aria-activedescendant` — ↑/↓ (and Home/End) move, Enter
 * opens, Esc closes and gives focus back to whatever had it. Tab cannot leave
 * the dialog.
 *
 * Typing is debounced and every request is cancelled the moment a newer one
 * starts, so a fast typist never sees results for a query they've moved past.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/errors'
import { MIN_SEARCH_LENGTH, searchEverything, type SearchHit, type SearchResult } from '../../api/search'
import { Icon } from '../../components/ui/Icon'
import { pushOverlay } from '../../components/ui/overlayStack'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { useSpaces } from '../spaces/SpacesProvider'
import {
  clearRecent,
  flatten,
  highlight,
  hrefFor,
  KIND_ICON,
  placeLine,
  readRecent,
  rememberSearch,
  shortcutLabel,
} from './model'

export const OPEN_SEARCH_EVENT = 'sl:open-search'
const DEBOUNCE_MS = 180
/** Past this, say the server is waking rather than leave a spinner. */
const SLOW_MS = 3500

type Status = 'idle' | 'loading' | 'done' | 'error'

export function SearchPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        // The browser's own Ctrl+K (focus the address bar's search) loses here.
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    const onOpen = () => setOpen(true)
    // Capture, so an editor that stops the key's propagation can't swallow it.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen)
    }
  }, [])

  if (!open) return null
  return <PaletteDialog onClose={() => setOpen(false)} />
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { spaces } = useSpaces()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<string[]>(() => readRecent())
  const [attempt, setAttempt] = useState(0)

  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  const trimmed = query.trim()
  const searching = trimmed.length >= MIN_SEARCH_LENGTH

  // Focus in on open, back out on close; stacked above any open dialog.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const layer = pushOverlay()
    const onKey = (e: KeyboardEvent) => {
      if (!layer.isTop()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
        return
      }
      // Trap: the input and the clear/close buttons are all there is.
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>('input, button:not([disabled]):not([tabindex="-1"])'),
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        } else if (!panelRef.current.contains(document.activeElement)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      layer.release()
      previouslyFocused?.focus?.()
    }
  }, [])

  // Debounced, cancellable fetch. Only the newest request may write state.
  useEffect(() => {
    if (!searching) {
      setResult(null)
      setStatus('idle')
      setError(null)
      setSlow(false)
      return
    }
    const controller = new AbortController()
    setStatus('loading')
    setSlow(false)
    const slowTimer = window.setTimeout(() => setSlow(true), DEBOUNCE_MS + SLOW_MS)
    const timer = window.setTimeout(() => {
      searchEverything(trimmed, { signal: controller.signal })
        .then((res) => {
          if (controller.signal.aborted) return
          setResult(res ?? { query: trimmed, groups: [], partial: false })
          setStatus('done')
          setError(null)
          setActive(0)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setError(friendlyMessage(err))
          setStatus('error')
        })
        .finally(() => {
          window.clearTimeout(slowTimer)
          if (!controller.signal.aborted) setSlow(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
      window.clearTimeout(slowTimer)
    }
  }, [trimmed, searching, attempt])

  const hits = useMemo(() => (status === 'done' ? flatten(result) : []), [result, status])
  // Without a query, the options are the recent searches.
  const showingRecent = !searching && recent.length > 0
  const optionCount = searching ? hits.length : showingRecent ? recent.length : 0
  const activeIndex = optionCount === 0 ? -1 : Math.min(active, optionCount - 1)
  const optionId = (i: number) => `${listId}-opt-${i}`

  // Keep the highlighted option in view as the arrows move it.
  useEffect(() => {
    if (activeIndex < 0) return
    document.getElementById(`${listId}-opt-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, listId])

  const openHit = useCallback(
    (hit: SearchHit) => {
      setRecent(rememberSearch(trimmed))
      const href = hrefFor(hit, spaces) ?? '/home'
      onClose()
      navigate(href)
    },
    [navigate, onClose, spaces, trimmed],
  )

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return // an IME is still building the word
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (optionCount === 0) return
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((optionCount + Math.max(activeIndex, 0) + step) % optionCount)
    } else if ((e.key === 'Home' || e.key === 'End') && optionCount > 0 && (e.ctrlKey || !query)) {
      e.preventDefault()
      setActive(e.key === 'Home' ? 0 : optionCount - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex < 0) return
      if (searching) {
        const hit = hits[activeIndex]
        if (hit) openHit(hit)
      } else if (showingRecent) {
        setQuery(recent[activeIndex])
        setActive(0)
      }
    }
  }

  const label = shortcutLabel()

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-well/80 backdrop-blur-[2px] motion-safe:animate-[dockSwap_180ms_var(--ease-sl)_both] sm:p-4 sm:pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        className="cardstock flex h-dvh w-full flex-col overflow-hidden shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)] sm:h-auto sm:max-h-[min(36rem,80dvh)] sm:max-w-xl sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 pt-[env(safe-area-inset-top)] sm:pt-0">
          <Icon name="search" size={18} className="ml-1 shrink-0 text-faint" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={optionCount > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-label="Search notes, cards, quizzes and files"
            placeholder="Search notes, cards, quizzes, files…"
            value={query}
            maxLength={100}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onInputKey}
            enterKeyHint="go"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              aria-label="Clear search"
              className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-faint transition-colors hover:bg-line-soft hover:text-ink"
            >
              <Icon name="close" size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded-md border border-line bg-well px-2 py-1 font-mono text-[11.5px] text-muted transition-colors hover:text-ink"
            aria-label="Close search"
          >
            Esc
          </button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" aria-live="polite">
          {!searching && (
            <IdleState
              listId={listId}
              recent={recent}
              activeIndex={activeIndex}
              optionId={optionId}
              shortcut={label}
              onPick={(q) => {
                setQuery(q)
                setActive(0)
                inputRef.current?.focus()
              }}
              onHover={setActive}
              onClear={() => {
                clearRecent()
                setRecent([])
                inputRef.current?.focus()
              }}
            />
          )}

          {searching && status === 'loading' && (
            <div className="flex flex-col gap-2 p-2" aria-label="Searching" role="status">
              {slow && <p className="px-1 pb-1 text-[13px] text-muted">Still looking — the server may be waking up.</p>}
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 shrink-0" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {searching && status === 'error' && (
            <div className="flex flex-col items-center gap-3 px-4 py-8 text-center" role="alert">
              <Icon name="alert" size={22} className="text-faint" />
              <p className="text-[14px] text-muted">{error}</p>
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="cursor-pointer rounded-lg border border-line bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-line-soft"
              >
                Try again
              </button>
            </div>
          )}

          {searching && status === 'done' && hits.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Icon name="search" size={22} className="text-faint" />
              <p className="text-[14px] text-ink">
                Nothing matches “<span className="break-all">{trimmed}</span>”.
              </p>
              <p className="text-[13px] text-muted">Try a shorter word, or part of a title.</p>
            </div>
          )}

          {searching && status === 'done' && hits.length > 0 && result && (
            <div id={listId} role="listbox" aria-label="Search results">
              {(() => {
                let index = -1
                return result.groups.map((group) => (
                  <div key={group.kind} role="group" aria-labelledby={`${listId}-${group.kind}`} className="pb-1">
                    <div id={`${listId}-${group.kind}`} className="setcode px-2 pb-1 pt-2 text-faint">
                      {group.label}
                    </div>
                    {group.hits.map((hit) => {
                      index += 1
                      const i = index
                      return (
                        <ResultRow
                          key={`${hit.kind}:${hit.id}`}
                          id={optionId(i)}
                          hit={hit}
                          query={trimmed}
                          active={i === activeIndex}
                          onHover={() => setActive(i)}
                          onPick={() => openHit(hit)}
                        />
                      )
                    })}
                  </div>
                ))
              })()}
              {result.partial && (
                <p className="px-2 pb-1 pt-2 text-[12.5px] text-faint">Some places couldn’t be searched just now.</p>
              )}
            </div>
          )}
        </div>

        <div className="hidden shrink-0 items-center gap-4 border-t border-line-soft px-4 py-2 text-[12px] text-faint sm:flex">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
          </span>
          <span>
            <Kbd>Enter</Kbd> to open
          </span>
          <span className="ml-auto">
            <Kbd>{label}</Kbd> anywhere
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[6px] border border-line bg-well px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
      {children}
    </kbd>
  )
}

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-brand-soft text-brand-deep">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

function ResultRow({
  id,
  hit,
  query,
  active,
  onHover,
  onPick,
}: {
  id: string
  hit: SearchHit
  query: string
  active: boolean
  onHover: () => void
  onPick: () => void
}) {
  const place = placeLine(hit)
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      // Keep focus in the input: a click picks, it doesn't move focus.
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={active ? undefined : onHover}
      onClick={onPick}
      className={cn(
        'flex min-h-12 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors motion-reduce:transition-none',
        active ? 'bg-raised' : 'hover:bg-line-soft',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line',
          active ? 'bg-brand-tint text-brand-300' : 'bg-well text-muted',
        )}
        aria-hidden="true"
      >
        <Icon name={KIND_ICON[hit.kind]} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] text-ink">
          <Marked text={hit.title} query={query} />
        </span>
        {hit.snippet && (
          <span className="line-clamp-2 break-words text-[12.5px] leading-snug text-muted">
            <Marked text={hit.snippet} query={query} />
          </span>
        )}
        {place && <span className="truncate text-[12px] text-faint">{place}</span>}
      </span>
      {active && <Icon name="arrowRight" size={14} className="mt-2 shrink-0 text-faint" aria-hidden="true" />}
    </div>
  )
}

function IdleState({
  listId,
  recent,
  activeIndex,
  optionId,
  shortcut,
  onPick,
  onHover,
  onClear,
}: {
  listId: string
  recent: string[]
  activeIndex: number
  optionId: (i: number) => string
  shortcut: string
  onPick: (q: string) => void
  onHover: (i: number) => void
  onClear: () => void
}) {
  if (recent.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[13.5px] text-muted">
        Type at least two letters to search your notes, cards, quizzes and files.
        <span className="mt-2 hidden text-[12px] text-faint sm:block">Open this from anywhere with {shortcut}.</span>
      </div>
    )
  }
  return (
    <div>
      <div className="flex items-center justify-between px-2 pb-1 pt-2">
        <span id={`${listId}-recent`} className="setcode text-faint">
          Recent searches
        </span>
        <button
          type="button"
          onClick={onClear}
          className="cursor-pointer rounded px-1.5 py-0.5 text-[12px] text-faint hover:text-ink"
        >
          Clear
        </button>
      </div>
      <div id={listId} role="listbox" aria-labelledby={`${listId}-recent`}>
        {recent.map((q, i) => (
          <div
            key={q}
            id={optionId(i)}
            role="option"
            aria-selected={i === activeIndex}
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => onHover(i)}
            onClick={() => onPick(q)}
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-[14px] text-ink-2',
              i === activeIndex ? 'bg-raised' : 'hover:bg-line-soft',
            )}
          >
            <Icon name="clock" size={15} className="shrink-0 text-faint" aria-hidden="true" />
            <span className="truncate">{q}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
