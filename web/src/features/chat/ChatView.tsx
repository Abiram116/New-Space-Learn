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
import { listMessages, streamChat, type ChatStreamEvent } from '../../api/chat'
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
import { useAsync } from '../../lib/useAsync'
import { SubspaceMissing } from '../spaces/SubspaceMissing'
import { ChatOnDesktop } from '../mobile/ChatOnDesktop'
import { useIsMobile } from '../../lib/useIsMobile'
import { LG_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import { AgentRunCard } from './AgentRunCard'
import { ChatSections } from './ChatSections'
import { ChatMessage } from './ChatMessage'
import { Composer } from './Composer'
import { ActiveAgentsStrip, ActiveSkillStrip, ContextDock } from './ContextDock'
import type { DockPanel } from './DockPanels'
import { ADD_FILE_EVENT } from './DockSources'
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
import { suggestFor } from './suggest'
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

function ChatViewInner({ subspaceId, subspaceName, base, onNavigate, showError }: Inner) {
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

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const NEAR_BOTTOM_PX = 96
    const onScroll = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const followBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el || !stickRef.current) return
    cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [])

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
    async (text: string, opts?: { regenerate?: boolean; images?: string[] }) => {
      const regenerate = opts?.regenerate ?? false
      // Sending (or regenerating) is the one moment that should always jump
      // back down, even if the reader had scrolled up mid-thread — it's their
      // own action putting a new turn at the bottom.
      stickRef.current = true
      // A regenerate is another attempt at a question already on screen, not
      // a new turn — appending a second identical bubble would show the
      // student's own question twice for one answer that changed. The
      // backend mirrors this: it does not re-store the question either.
      if (!regenerate) {
        const optimistic: Message = {
          id: `tmp-${Date.now()}`,
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
      const pacer = new StreamPacer({ instant: reducedMotion })
      const turn = ++turnRef.current
      let citations: Citation[] = []
      setStream({ pacer, citations, turn })
      setStreaming(true)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        for await (const evt of streamChat(
          subspaceId,
          text,
          controller.signal,
          regenerate,
          opts?.images ?? [],
        )) {
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
              created_at: new Date().toISOString(),
            }
            settledRef.current.add(assistant.id)
            history.setData((prev) => [...(prev ?? []), assistant])
            setStream(null)
          } else if (evt.type === 'error') {
            throw new Error(evt.message)
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) showError(err)
        setStream((s) => (s && s.pacer === pacer ? null : s))
      } finally {
        pacer.dispose()
        setStreaming(false)
        abortRef.current = null
      }
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
  const agentRuns = useAgentRuns({ subspaceId, base, navigate: onNavigate, getSourceText })
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
            <div className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
              {history.error}
            </div>
          )}
          {isEmpty && (
            <EmptyState
              icon="chat"
              title={`Start learning ${subspaceName}`}
              description="Add a PDF or notes, then ask a question. Answers cite the pages they came from."
              action={
                // The next step is the only button on the page. It used to be a
                // sentence pointing at a tab, which left the one thing a new
                // student must do as the one thing without a button.
                <Button
                  // One orange button per screen: with the sidebar on screen it
                  // owns the call to action, and this one stays quiet.
                  variant={hasSidebar ? 'secondary' : 'primary'}
                  onClick={() =>
                    hasSidebar ? window.dispatchEvent(new Event(ADD_FILE_EVENT)) : onNavigate(`${base}/docs`)
                  }
                >
                  <Icon name="plus" size={14} /> Add files
                </Button>
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
          suggestion={hasReadyFile ? (followUp ?? suggestFor(userMessagesInOrder.length)) : undefined}
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

