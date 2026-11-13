/**
 * Subspace chat screen — RAG-aware, streams tokens, hands off to agents.
 *
 * State machine per turn:
 *   idle → sending (user's message optimistic-appended) → streaming (assistant
 *   bubble accumulating tokens) → done (persist assistant reply) | error.
 *
 * Agent hand-offs (from composer or dock) call the corresponding API and
 * navigate to the resource once created, so the chat doesn't become a
 * dashboard of side effects.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { LIMITS } from '../../lib/limits'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ChatReturnState } from '../../lib/fromChat'
import { getStarters, listMessages, streamChat, type ChatStreamEvent } from '../../api/chat'
import { listDocuments } from '../../api/documents'
import { listPreferences, sendFeedback, type Preference } from '../../api/feedback'
import type { ChatMessage as Message, Citation } from '../../api/types'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon } from '../../components/ui/Icon'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { useReducedMotion } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { useActiveSubspace } from '../../lib/nav'
import { cn } from '../../lib/cn'
import { useAsync } from '../../lib/useAsync'
import { SubspaceMissing } from '../spaces/SubspaceMissing'
import { ChatOnDesktop } from '../mobile/ChatOnDesktop'
import { useIsMobile } from '../../lib/useIsMobile'
import { LG_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import { AgentRunCard } from './AgentRunCard'
import { ChatSections } from './ChatSections'
import { getStudentModel } from '../../api/me'
import { STUDENT_MODEL_KEY } from '../onboarding/skippedStyle'
import { useCachedStudentModel } from '../onboarding/StyleIntakeCard'
import { modeStarter } from '../../lib/studyMode'
import { ChatMessage } from './ChatMessage'
import { Composer } from './Composer'
import { ActiveAgentsStrip, ActiveSkillStrip, ContextDock } from './ContextDock'
import type { DockPanel } from './DockPanels'
import { NoteBriefDialog } from './NoteBriefDialog'
import {
  askReason,
  chipsFor,
  consecutiveConfusion,
  readSignal,
  type AskInput,
  type TurnSignal,
} from './feedbackPolicy'
import type { AgentKey } from './agents'
import { nextSuggestion, topicStarters } from './suggest'
import { suggestSwitch } from '../../lib/localSwitch'
import { setTopicScope, topicScopeNow, useTopicScopeChoice } from '../../lib/topicScope'
import { getSettings } from '../../api/me'
import { StreamingMessage } from './StreamingMessage'
import { StreamPacer } from './streamPacer'
import { clampTopic, useAgentRuns } from './useAgentRuns'

export function ChatView() {
  const { space, subspace, base } = useActiveSubspace()
  const navigate = useNavigate()
  const { showError } = useToast()
  // Phones have no chat. The routes already send phones elsewhere (see
  // routes/TopicRoutes); this is the backstop if anything mounts chat anyway.
  const mobile = useIsMobile()

  if (mobile) return <ChatOnDesktop />
  if (!space || !subspace) return <SubspaceMissing />

  return (
    <ChatViewInner
      key={subspace.id}
      subspaceId={subspace.id}
      subspaceName={subspace.name}
      spaceName={space.name}
      base={base}
      onNavigate={navigate}
      showError={showError}
    />
  )
}

type Inner = {
  subspaceId: string
  subspaceName: string
  spaceName: string
  base: string
  onNavigate: ReturnType<typeof useNavigate>
  showError: (e: unknown) => void
}

function ChatViewInner({ subspaceId, subspaceName, spaceName, base, onNavigate, showError }: Inner) {
  // The sidebar exists from `lg:` up; below that its two jobs move to strips above
  // the composer. Mount one set or the other — never both — so a width fetches
  // only the data it shows.
  const hasSidebar = useMediaQuery(LG_QUERY)
  // Keyed, so coming back to a topic paints its conversation at once from the
  // last copy and revalidates behind it. Sending needs no explicit invalidation:
  // `history.setData` (the optimistic question, the finished answer) writes to
  // this same entry, so the cache is never behind what the student just did.
  const history = useAsync(() => listMessages(subspaceId), [subspaceId], `messages:${subspaceId}`)
  // Same cache key as the sidebar's file list, so this costs no extra trip once it has loaded.
  const docs = useAsync(() => listDocuments(subspaceId), [subspaceId], `docs:${subspaceId}`)
  // Starter questions written from this topic's own files. Asked again only
  // when the set of ready files changes; the server caches them too.
  const readyKey = (docs.data ?? [])
    .filter((d) => d.status === 'ready')
    .map((d) => d.id)
    .sort()
    .join(',')
  // Read here (shared cache key) now that nothing above the composer loads it:
  // the opening question for interview / exam modes comes from it.
  useAsync(getStudentModel, [], STUDENT_MODEL_KEY)
  const studyMode = useCachedStudentModel()?.study_mode ?? null
  const [tutorBusy, setTutorBusy] = useState(false)
  const starters = useAsync(
    () => (readyKey ? getStarters(subspaceId) : Promise.resolve({ questions: [] as string[] })),
    [subspaceId, readyKey],
    `starters:${subspaceId}:${readyKey}`,
  )
  const suggestOn = suggestSwitch.use()
  // How strict this topic's tutor is: the student's choice for this topic, or
  // the account-wide setting until they make one.
  const scopeChoice = useTopicScopeChoice(subspaceId)
  const accountSettings = useAsync(() => getSettings(), [], 'settings')
  const scope = scopeChoice ?? (accountSettings.data?.answer_only_from_docs === false ? 'subject' : 'files')
  /* The live turn. Tokens do NOT flow through React state: they go into
     `pacer`, which reveals them on requestAnimationFrame, and only
     `StreamingMessage` subscribes to it. This component re-renders when a turn
     starts, gains a citation, or ends — not once per frame — so the thread of
     finished, memoized messages is never touched mid-stream. */
  const [stream, setStream] = useState<{ pacer: StreamPacer; citations: Citation[]; turn: number } | null>(null)
  const streamRef = useRef(stream)
  streamRef.current = stream
  const turnRef = useRef(0)
  /* Replies that streamed in this session and are now final. They skip the
     entrance lift (see ChatMessage's `instant`), since the same text has
     already been on screen for seconds. */
  const settledRef = useRef(new Set<string>())
  const reducedMotion = useReducedMotion()
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  /* Consecutive regenerations of the CURRENT answer — reset the moment a
     genuine new question is asked (see `send`, non-regenerate branch), so
     regenerating an old answer and then moving on doesn't carry a stale count
     into an unrelated one. `feedbackPolicy.askReason` only escalates to
     `repeated_regenerate` on the second consecutive regenerate; the first is
     treated as ordinary dissatisfaction, not yet a signal worth interrupting
     for. */
  const [regenerations, setRegenerations] = useState(0)

  /* Auto-scroll to bottom, without fighting a student who scrolled up mid-
     stream to reread something.
     This used to run a synchronous `scrollTop = scrollHeight` — a forced
     layout read and write — once per token, unconditionally: scrolled up to
     check an earlier message while the answer kept streaming, and the view
     yanked you back to the bottom on the very next token. `stickRef` tracks
     whether the reader is already at the bottom (updated by a passive scroll
     listener, not read every render), and the scroll itself is coalesced onto
     one rAF so several growth notifications between paints cost one layout
     write. The streaming bubble calls `followBottom` after each revealed
     frame. */
  const stickRef = useRef(true)
  const scrollRafRef = useRef(0)
  /* The question a reply belongs to, while that reply is the newest. A reply
     is read from its first line, so instead of chasing the bottom of a long
     answer the view follows it only until the question reaches the top, then
     holds still — the start of the answer stays on screen, and the end of it
     is the reader's to scroll to. Cleared the moment the reader scrolls. */
  const anchorRef = useRef<string | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const NEAR_BOTTOM_PX = 96
    const onScroll = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    }
    // Only a person scrolls with a wheel, a finger or a key; the view's own
    // scrolling fires `scroll` too, so that event can't tell the two apart.
    const onIntent = () => {
      anchorRef.current = null
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onIntent, { passive: true })
    el.addEventListener('touchmove', onIntent, { passive: true })
    el.addEventListener('keydown', onIntent)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onIntent)
      el.removeEventListener('touchmove', onIntent)
      el.removeEventListener('keydown', onIntent)
    }
  }, [])

  const followBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const anchor = anchorRef.current
    if (anchor) {
      cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = requestAnimationFrame(() => {
        const question = document.getElementById(`msg-${anchor}`)
        if (!question) return
        const top =
          question.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 16
        const target = Math.min(el.scrollHeight - el.clientHeight, top)
        // Only ever forward: the answer growing never pulls the view back up.
        if (target > el.scrollTop) el.scrollTop = target
      })
      return
    }
    if (!stickRef.current) return
    cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [])

  // A different topic's thread opens at its newest message, as before.
  useEffect(() => {
    anchorRef.current = null
  }, [subspaceId])

  useEffect(() => {
    followBottom()
    return () => cancelAnimationFrame(scrollRafRef.current)
  }, [history.data, stream?.turn, followBottom])

  /* Stop keeps what was already written. The partial answer is flushed to the
     screen instantly and stays as a local message — it was never saved by the
     server, so it is marked with an `srv-` id (no feedback row, no
     regenerate-feedback against a row that doesn't exist). */
  const cancel = useCallback(() => {
    abortRef.current?.abort()
    const live = streamRef.current
    if (live) {
      live.pacer.flush()
      const partial = live.pacer.received.trim()
      if (partial) {
        const id = `srv-stopped-${Date.now()}`
        settledRef.current.add(id)
        history.setData((prev) => [
          ...(prev ?? []),
          {
            id,
            role: 'assistant',
            content: partial,
            citations: live.citations.length ? live.citations : null,
            created_at: new Date().toISOString(),
          },
        ])
      }
      live.pacer.dispose()
    }
    setStreaming(false)
    setStream(null)
  }, [history])

  const send = useCallback(
    async (text: string, opts?: { regenerate?: boolean; images?: string[] }): Promise<boolean> => {
      const regenerate = opts?.regenerate ?? false
      // One answer at a time: a second turn started over a live one had both
      // streams writing to the same bubble.
      if (abortRef.current && !abortRef.current.signal.aborted) return false
      // Sending (or regenerating) is the one moment that should always jump
      // back down, even if the reader had scrolled up mid-thread — it's their
      // own action putting a new turn at the bottom.
      stickRef.current = true
      setTutorBusy(false)
      // A regenerate is another attempt at a question already on screen, not
      // a new turn — appending a second identical bubble would show the
      // student's own question twice for one answer that changed. The
      // backend mirrors this: it does not re-store the question either.
      const optimisticId = `tmp-${Date.now()}`
      // Pin the question this reply answers: the new one, or for a regenerate
      // the one already on screen.
      anchorRef.current = regenerate
        ? ([...(historyRef.current ?? [])].reverse().find((m) => m.role === 'user')?.id ?? null)
        : optimisticId
      if (!regenerate) {
        const optimistic: Message = {
          id: optimisticId,
          role: 'user',
          content: text,
          created_at: new Date().toISOString(),
        }
        history.setData((prev) => [...(prev ?? []), optimistic])
        // A genuinely new question starts a new answer chain — an old
        // regenerate count must not carry over and falsely trigger
        // `repeated_regenerate` on an answer nobody has regenerated yet.
        setRegenerations(0)
      }
      // A regenerate REPLACES the answer to this question. The old reply comes
      // off the screen as the new one starts (the server drops it once the new
      // one is saved), instead of sitting above a second answer to the same
      // question. If the new attempt fails, it is put back below.
      let replaced: Message[] = []
      if (regenerate) {
        const all = historyRef.current ?? []
        const lastAsk = all.map((m) => m.role).lastIndexOf('user')
        replaced = all.slice(lastAsk + 1).filter((m) => m.role === 'assistant')
        if (replaced.length) {
          const gone = new Set(replaced.map((m) => m.id))
          history.setData((prev) => (prev ?? []).filter((m) => !gone.has(m.id)))
        }
      }
      const pacer = new StreamPacer({ instant: reducedMotion })
      const turn = ++turnRef.current
      let citations: Citation[] = []
      setStream({ pacer, citations, turn })
      setStreaming(true)
      const controller = new AbortController()
      abortRef.current = controller
      let finished = false
      // Anything at all came back on the stream: the server has the question.
      let accepted = false
      try {
        for await (const evt of streamChat(
          subspaceId,
          text,
          controller.signal,
          regenerate,
          opts?.images ?? [],
          topicScopeNow(subspaceId),
        )) {
          accepted = true
          if (evt.type === 'token') {
            pacer.push(evt.delta)
          } else if (evt.type === 'citation') {
            citations = dedupeCitations([...citations, evt.citation])
            const next = citations
            setStream((s) => (s && s.pacer === pacer ? { ...s, citations: next } : s))
          } else if (evt.type === 'done') {
            const resolved = resolveDone(evt, { text: pacer.received, citations })
            // The stream is over: show whatever is still queued right now.
            pacer.flush()
            const assistant: Message = {
              // The REAL row id, not a fabricated one.
              //
              // The server has always sent `message_id` on the `done` event and
              // `chat.ts` has always parsed it — this callback just didn't take
              // it, so every freshly streamed answer got `srv-<timestamp>` and
              // was unaddressable until a reload. Nothing could be attached to
              // it: no feedback, no regenerate, no permalink. The fallback is
              // kept for the case where an older backend sends no id, and it is
              // marked so callers can tell a real id from a placeholder.
              id: evt.messageId ?? `srv-${Date.now()}`,
              role: 'assistant',
              content: resolved.text,
              citations: resolved.citations.length ? resolved.citations : null,
              suggestion: evt.suggestion,
              personal: evt.personal?.length ? evt.personal : null,
              grounding: evt.grounding ?? null,
              created_at: new Date().toISOString(),
            }
            settledRef.current.add(assistant.id)
            history.setData((prev) => [...(prev ?? []), assistant])
            setStream(null)
            finished = true
          } else if (evt.type === 'error') {
            // A busy or limited model is not a dead end: remember it so the
            // thread can offer what needs no model while the student waits.
            if (evt.code === 'upstream_unavailable' || evt.code === 'rate_limited') setTutorBusy(true)
            throw new Error(evt.message)
          }
        }
        // The connection closed with no `done`: without this the thinking
        // dots stayed on screen for good.
        if (!finished && !controller.signal.aborted) throw new Error('The answer stopped early. Try again.')
      } catch (err) {
        if (!controller.signal.aborted) showError(err)
        setStream((s) => (s && s.pacer === pacer ? null : s))
        // The new attempt failed: the answer it was meant to replace is still
        // the student's best one, so it goes back.
        if (replaced.length && !finished && !controller.signal.aborted) {
          history.setData((prev) => [...(prev ?? []), ...replaced])
        }
        /* Refused before it began (today's answers used up, offline, a
           validation error): the server never stored the question, so the
           bubble would be gone on the next reload anyway and the words with
           it. Take the bubble back out and hand the text back to the composer
           (see its `onSend`). */
        if (!accepted && !regenerate && !controller.signal.aborted) {
          history.setData((prev) => (prev ?? []).filter((m) => m.id !== optimisticId))
          return false
        }
      } finally {
        pacer.dispose()
        // Only if this is still the live turn: a stopped turn unwinds a moment
        // after Stop, and must not switch off the turn that was sent next.
        if (abortRef.current === controller) {
          setStreaming(false)
          abortRef.current = null
        }
      }
      return true
    },
    [subspaceId, history, showError, reducedMotion],
  )

  /* The notes agent asks before it writes; the other two don't.
     Not an inconsistency — a note is the one artifact here the student then
     *keeps and edits*, so its shape is worth a question. A quiz and a deck are
     regenerable in one click if the first attempt isn't useful. */
  const [noteBrief, setNoteBrief] = useState<{ topic?: string } | null>(null)

  /* All three entry points — dock buttons, the mobile strip, and the
     composer's slash commands — start an agent through this one hook, so they
     share the busy flag, the in-thread progress card, the success beat before
     the redirect, and Retry on failure. */
  const historyRef = useRef(history.data)
  useEffect(() => {
    historyRef.current = history.data
  }, [history.data])
  // Seed a deck from the last answer when there is one; otherwise the
  // generator draws on whatever this topic has indexed.
  const getSourceText = useCallback(
    () => lastAssistant(historyRef.current ?? [])?.content,
    [],
  )
  // A finished run opens what it made by itself, unless that would take
  // something away: an answer still arriving, or a question half typed.
  const stay = useCallback(() => {
    const draft = document.querySelector<HTMLTextAreaElement>('[data-chat-input]')?.value.trim()
    return Boolean(draft) || Boolean(abortRef.current && !abortRef.current.signal.aborted)
  }, [])
  const agentRuns = useAgentRuns({ subspaceId, base, navigate: onNavigate, getSourceText, stay })
  const { runs, busy, start: startRun, retry: retryRun, dismiss: dismissRun, open: openRun } = agentRuns

  useEffect(() => {
    followBottom()
  }, [runs, followBottom])

  const runAgent = useCallback(
    (agent: AgentKey, argument?: string) => {
      if (agent === 'notes') {
        setNoteBrief({ topic: clampTopic(argument, LIMITS.noteTopic) })
        return
      }
      stickRef.current = true
      startRun(agent, { topic: argument })
    },
    [startRun],
  )

  const writeNote = useCallback(
    (input: { topic?: string; instructions?: string }) => {
      // The dialog closes at once and the thread takes over: a progress card,
      // then a result with a way in. A failure is retried from the card with
      // the same brief, so nothing typed is lost.
      setNoteBrief(null)
      stickRef.current = true
      startRun('notes', input)
    },
    [startRun],
  )

  /* Feedback offer state.
     Session-scoped rather than persisted: the policy's job is to stop this
     being a nag inside one sitting, and carrying "last offered" across reloads
     would need a write on every render for a control most students will use a
     handful of times. The confidence gate is what provides the long-term
     memory — once a preference is settled the chips stop appearing at all,
     whatever this state says. */
  const [offerState, setOfferState] = useState<{
    lastOfferedAt: number | null
    lastGivenAt: number | null
  }>({ lastOfferedAt: null, lastGivenAt: null })

  /* Preferences drive the expected-value gate. Fetched once per mount and
     deliberately NOT refetched after each tap: one tap cannot move a
     preference past the threshold on its own, and a round trip per chip press
     would put latency inside the interaction the chips exist to keep cheap. */
  /* Which workspace panel the dock is showing. `null` is the overview.
     Held here rather than in the URL: it is a view preference inside one
     page, not a location — putting it in the URL would add a history entry
     per glance at your sources and make Back mean "close the panel" instead
     of "leave the chat". */
  // Back from a full page the sidebar was left on (a quiz, a review): reopen that panel.
  const location = useLocation()
  const [dockPanel, setDockPanel] = useState<DockPanel>(
    () => (location.state as ChatReturnState | null)?.dockPanel ?? null,
  )

  const [prefs, setPrefs] = useState<Preference[]>([])
  useEffect(() => {
    let live = true
    listPreferences()
      .then((p) => live && setPrefs(p))
      // A failed preference read must never break chat. Empty means the gate
      // is open, which errs toward asking — the recoverable direction.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  // Belt-and-suspenders: two adjacent bubbles with identical role+content are
  // never meaningful to show twice, whatever produced them (a retried
  // request, a dev-only HMR remount mid-stream). Collapse rather than trust
  // every upstream path to be perfectly exactly-once.
  const messages = dedupeAdjacent(history.data ?? [])
  const isEmpty = !history.loading && messages.length === 0 && !stream
  const assistantTurns = messages.filter((m) => m.role === 'assistant').length

  /* What the student's most recent message signalled, if anything.
     This is the event the ask policy keys off — a counter told us only that
     time had passed, which is not a reason to interrupt anyone. */
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
  const turnSignal: TurnSignal =
    regenerations > 0 ? 'regenerated' : readSignal(lastUserMessage?.content ?? '')

  /* How many confusion signals in a row, ending at this one — the `confusion`
     trigger only fires on the first (see feedbackPolicy's docstring). Every
     user turn in order, not just the last one: consecutiveConfusion needs the
     run leading up to it, not a single message. */
  // The follow-up the last answer came with (kept on the message, so it survives a reload).
  // Once a new question is the latest turn there is nothing to offer until its answer lands.
  const last = messages[messages.length - 1]
  const followUp = last?.role === 'assistant' ? (last.suggestion ?? null) : null
  // Something to ask about: a file of its own that is ready, or answers that already
  // came from sources (a topic can answer from files linked in from another topic,
  // and then has no file of its own to count).
  const hasReadyFile =
    (docs.data ?? []).some((d) => d.status === 'ready') ||
    messages.some((m) => m.role === 'assistant' && (m.citations?.length ?? 0) > 0)
  const userMessagesInOrder = messages.filter((m) => m.role === 'user').map((m) => m.content)
  // Files were added and none can be answered from yet.
  const stillReading =
    !hasReadyFile && (docs.data ?? []).some((d) => d.status === 'processing' || d.status === 'uploading')
  // The sidebar re-reads the list while a file is being read (same cache
  // entry). Without it, nothing did, and the line below never went away.
  const refreshDocs = docs.refresh
  useEffect(() => {
    if (!stillReading || hasSidebar) return
    const t = window.setTimeout(refreshDocs, 4000)
    return () => window.clearTimeout(t)
  }, [stillReading, hasSidebar, docs.data, refreshDocs])

  /* Built once, used by both `chipsFor` and `askReason`. Calling them with
     independently-assembled inputs is how the row ends up showing chips with
     no reason, or a reason with no chips. */
  const askInput = (chars: number): AskInput => ({
    chars,
    signal: turnSignal,
    regenerations,
    assistantTurns,
    turnsSinceOffered:
      offerState.lastOfferedAt === null ? null : assistantTurns - offerState.lastOfferedAt,
    turnsSinceGiven:
      offerState.lastGivenAt === null ? null : assistantTurns - offerState.lastGivenAt,
    preferences: prefs,
    complete: true,
    consecutiveConfusion: consecutiveConfusion(userMessagesInOrder),
  })

  /* Try that again.
     Two things happen, in this order: the dissatisfaction is recorded first
     (so it lands even if the resend then fails or is aborted), then a fresh
     attempt at the same question streams in as a new answer alongside the
     old one — nothing is deleted, so a student comparing two explanations of
     the same thing still can. `regenerate: 'regenerate'` carries no stated
     direction on its own (see `preferences.FEEDBACK_KINDS` on the backend):
     it lowers every leading preference a little rather than pointing
     anywhere, which is the honest read of "that didn't land, try again"
     with nothing else said. */
  const regenerate = useCallback(async () => {
    if (streaming) return
    const question = lastUserMessage?.content
    if (!question) return
    const target = lastAssistant(messages)
    if (target && !target.id.startsWith('srv-') && target.id !== 'pending') {
      void sendFeedback({
        surface: 'chat',
        target_id: target.id,
        subspace_id: subspaceId,
        kind: 'regenerate',
      }).catch(() => {
        // Silent, same as every other feedback tap — losing one signal is a
        // rounding error against blocking the regenerate itself on it.
      })
    }
    setRegenerations((n) => n + 1)
    await send(question, { regenerate: true })
  }, [streaming, lastUserMessage, messages, subspaceId, send])

  /* A question left without an answer: Stop pressed, or the answer broke
     part-way. The server has the question, so this is another go at it (no
     second bubble) and, unlike `regenerate`, says nothing about an answer
     being poor: there was none to judge. */
  const unanswered =
    !streaming && !stream && last !== undefined && (last.role === 'user' || last.id.startsWith('srv-stopped-'))
  const retry = useCallback(() => {
    const question = lastUserMessage?.content
    if (question) void send(question, { regenerate: true })
  }, [lastUserMessage, send])

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* With the sidebar on screen, Files / Notes / Quizzes / Cards are opened
            from the sidebar and this row is not shown: one way to each. Below
            `lg` there is no sidebar, so they stay as links. */}
        <SubspaceHeader sections={hasSidebar ? undefined : <ChatSections base={base} />} />

        {/* Messages sit in a centred, measured column — the scroller stays
            full-width so the scrollbar hugs the window edge rather than
            floating in the middle of the page. On a wide monitor the old
            full-bleed layout ran an answer to ~1600px, which is roughly
            three times the line length the eye can track without losing
            its place on the return sweep. */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {/* `justify-end` with `min-h-full`: a short conversation sits just
              above the composer instead of pinned to the top with a screen of
              empty space beneath it. Once the thread is long enough to scroll,
              this has no effect at all. */}
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end gap-5 px-5 pb-2 pt-6">
          {history.loading && <PageSpinner />}
          {history.error && !history.loading && (
            <div className="flex flex-col items-start gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
              {/* A topic deleted somewhere else (another tab, another device) answers
                  "not found": say what happened, not the server's wording. */}
              <p>{/not found/i.test(history.error) ? 'This topic no longer exists. It may have been deleted.' : history.error}</p>
              <div className="flex gap-2">
                {!/not found/i.test(history.error) && (
                  <Button size="sm" variant="secondary" onClick={() => history.refresh()}>
                    Try again
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => onNavigate('/home')}>
                  Go to Home
                </Button>
              </div>
            </div>
          )}
          {isEmpty && (
            <EmptyState
              icon="chat"
              title={`Start learning ${subspaceName}`}
              description={
                hasReadyFile
                  ? 'Your files are ready. Ask a question, or start with one of the ideas below.'
                  : scope === 'subject'
                    ? `No files yet. Start with a question below and it is answered from general knowledge in ${spaceName}, marked as not from your files. Add a PDF and answers cite your pages.`
                    : 'You are on “My files only”, so answers come only from your files, and there are none yet. Add a PDF or notes, or let answers use general knowledge of the subject too.'
              }
              // With the dock on screen it already offers "Add a file" twice (the drop area
              // and "Next step"), so a third identical button here is only noise. Without
              // the dock (a narrow window) this is the one way to the next step.
              action={
                hasReadyFile ? undefined : (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {!hasSidebar && (
                      <Button onClick={() => onNavigate(`${base}/docs`)}>
                        <Icon name="plus" size={14} /> Add files
                      </Button>
                    )}
                    {scope === 'files' && (
                      <Button variant="secondary" onClick={() => setTopicScope(subspaceId, 'subject')}>
                        <Icon name="book" size={14} /> Also use subject knowledge
                      </Button>
                    )}
                  </div>
                )
              }
            />
          )}

          {messages.map((m, i) => (
            <ChatMessage
              key={m.id}
              message={m}
              subspaceId={subspaceId}
              base={base}
              instant={settledRef.current.has(m.id)}
              // Chips only under the LAST answer, and only when it is complete.
              // Under an older message they'd be asking about something the
              // student has already moved past, and a row of stale controls up
              // the scrollback is visual noise that never gets used.
              feedback={
                i === messages.length - 1 && m.role === 'assistant' && !streaming
                  ? {
                      chips: chipsFor(askInput(m.content.length)),
                      reason: askReason(askInput(m.content.length)),
                      messageId: m.id,
                      subspaceId,
                      onRecorded: () =>
                        setOfferState((s) => ({ ...s, lastGivenAt: assistantTurns })),
                      onOffered: () =>
                        setOfferState((s) =>
                          s.lastOfferedAt === assistantTurns
                            ? s
                            : { ...s, lastOfferedAt: assistantTurns },
                        ),
                      onRegenerate: regenerate,
                    }
                  : undefined
              }
            />
          ))}

          {unanswered && (
            <button
              type="button"
              onClick={retry}
              className={cn(
                '-mt-3 flex min-h-8 w-fit cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-semibold text-muted transition-colors hover:text-ink',
                last?.role === 'user' ? 'self-end' : 'self-start',
              )}
            >
              <Icon name="refresh" size={13} /> Try again
            </button>
          )}

          {tutorBusy && !streaming && (
            <div role="status" className="flex flex-col gap-2 rounded-xl border border-line bg-raised px-4 py-3 text-[13.5px] text-ink-2">
              <p>The tutor is busy right now. Your question is saved. Try again in a minute. Meanwhile, these don’t need it:</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => onNavigate(`${base}/flashcards?review=due`)}>
                  Review due cards
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onNavigate(`${base}/notes`)}>
                  Read your notes
                </Button>
              </div>
            </div>
          )}

          {stream && (
            <StreamingMessage
              key={stream.turn}
              pacer={stream.pacer}
              citations={stream.citations}
              base={base}
              onGrow={followBottom}
            />
          )}

          {runs.map((run) => (
            <AgentRunCard
              key={run.id}
              run={run}
              onOpen={(r) => r.href && openRun(r.id, r.href)}
              onRetry={(r) => retryRun(r.id)}
              onDismiss={(r) => dismissRun(r.id)}
            />
          ))}
          </div>
        </div>

        {/* Only below lg, where the dock isn't there to say either of these. */}
        {!hasSidebar && (
          <>
            <ActiveAgentsStrip onRunAgent={runAgent} busy={busy} />
            <ActiveSkillStrip subspaceId={subspaceId} />
          </>
        )}

        <Composer
          placeholder={`Ask about ${subspaceName}…`}
          onSend={send}
          onCancel={cancel}
          onRunAgent={runAgent}
          streaming={streaming}
          // An empty chat offers three to pick from instead of the one in the box.
          suggestion={
            // Any chat with something in it, files or not: a topic made of notes
            // and conversation deserves the → as much as one made of PDFs.
            suggestOn && !isEmpty
              ? (followUp ??
                nextSuggestion(
                  hasReadyFile ? (starters.data?.questions ?? []) : topicStarters(subspaceName, spaceName),
                  userMessagesInOrder,
                ))
              : undefined
          }
          // An empty chat opens with questions about this topic's own files;
          // the generic ideas only while those are still being written.
          examples={
            suggestOn && isEmpty && !hasReadyFile && !stillReading && scope === 'subject'
              ? withModeStarter(studyMode, topicStarters(subspaceName, spaceName))
              : suggestOn && isEmpty && hasReadyFile
              ? withModeStarter(
                  studyMode,
                  starters.data?.questions.length
                    ? starters.data.questions
                    : starters.loading
                      ? undefined
                      : topicStarters(subspaceName, spaceName),
                )
              : undefined
          }
          notice={stillReading ? 'Your file is still being read. Answers will use it once it’s ready.' : undefined}
          draftKey={subspaceId}
          scope={scope}
          onScope={(next) => setTopicScope(subspaceId, next)}
        />
      </div>

      {hasSidebar && (
        <ContextDock
          subspaceId={subspaceId}
          base={base}
          onRunAgent={runAgent}
          busy={busy}
          panel={dockPanel}
          onClosePanel={() => setDockPanel(null)}
          onOpenPanel={setDockPanel}
          questionsAsked={history.loading ? null : userMessagesInOrder.length}
          questions={messages.filter((m) => m.role === 'user').map((m) => ({ id: m.id, text: m.content }))}
        />
      )}

      <NoteBriefDialog
        open={noteBrief !== null}
        topic={noteBrief?.topic}
        busy={busy.notes}
        onCancel={() => setNoteBrief(null)}
        onGenerate={writeNote}
      />
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

/** The mode's own opening move first ("Interview me…"), then the topic's questions. */
function withModeStarter(mode: string | null, questions: string[] | undefined): string[] | undefined {
  if (!questions) return questions
  const first = modeStarter(mode)
  return first ? [first, ...questions.filter((q) => q !== first)].slice(0, 4) : questions
}

/**
 * What the finished message actually is, given the `done` event and
 * whatever had streamed in so far. Pulled out of `handleEvent` so this
 * decision is testable on its own, the same reason `clearAiPlaceholder` and
 * `format.ts` are their own functions rather than logic buried in a closure.
 *
 * Mirrors the backend's `rag.strip_invalid_citations` reconciliation: tokens
 * stream raw, so if the server stripped an out-of-range `[[n]]` marker after
 * the fact, the streamed buffer and the stored row disagree. `evt.content`
 * is canonical — prefer it, falling back to the streamed buffer only for an
 * older backend that doesn't send it.
 *
 * Citations follow the opposite fallback direction on purpose: an *empty*
 * `evt.citations` does not mean "no citations" — every citation the model
 * used was already sent as a separate `citation` event during the stream,
 * so falling back to `prev.citations` here (instead of the server's empty
 * array) is what keeps the source cards the student already saw from
 * disappearing the instant the stream ends.
 */
export function resolveDone(
  evt: Pick<Extract<ChatStreamEvent, { type: 'done' }>, 'content' | 'citations'>,
  prev: { text: string; citations: Citation[] } | null,
): { text: string; citations: Citation[] } {
  return {
    text: (evt.content ?? prev?.text ?? '').trim() || '(no reply)',
    citations: evt.citations.length ? evt.citations : (prev?.citations ?? []),
  }
}

function dedupeCitations(cs: Citation[]): Citation[] {
  const seen = new Set<number>()
  const out: Citation[] = []
  for (const c of cs) {
    if (seen.has(c.marker)) continue
    seen.add(c.marker)
    out.push(c)
  }
  return out
}

function dedupeAdjacent(messages: Message[]): Message[] {
  const out: Message[] = []
  for (const m of messages) {
    const prev = out[out.length - 1]
    if (prev && prev.role === m.role && prev.content === m.content) continue
    out.push(m)
  }
  return out
}

function lastAssistant(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i]
  }
  return null
}

