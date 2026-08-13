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
import { useNavigate } from 'react-router-dom'
import { listMessages, streamChat, type ChatStreamEvent } from '../../api/chat'
import { listPreferences, sendFeedback, type Preference } from '../../api/feedback'
import { generateCards } from '../../api/flashcards'
import { generateNote } from '../../api/notes'
import { generateQuiz } from '../../api/quizzes'
import type { ChatMessage as Message, Citation } from '../../api/types'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { useToast } from '../../components/ui/Toast'
import { useActiveSubspace } from '../../lib/nav'
import { firstSentence } from '../../lib/text'
import { useAsync } from '../../lib/useAsync'
import { SubspaceMissing } from '../spaces/SubspaceMissing'
import { ChatMessage } from './ChatMessage'
import { Composer } from './Composer'
import { ActiveSkillStrip, ContextDock } from './ContextDock'
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

/**
 * A slash-command argument, cut to what the endpoint will accept.
 *
 * `/quiz <topic>` takes the rest of the composer line, and the composer is
 * capped at 4000 characters while every `topic` field on the API is capped at
 * 120–140. A `maxLength` cannot help here — the text is one field being read
 * as two — so the clamp belongs at the point the argument is handed to a
 * request. Truncating a topic is lossless in practice: it is a phrase used to
 * steer retrieval, not content that gets stored.
 */
function clampTopic(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

export function ChatView() {
  const { space, subspace, base } = useActiveSubspace()
  const navigate = useNavigate()
  const { show, showError } = useToast()

  if (!space || !subspace) return <SubspaceMissing />

  return (
    <ChatViewInner
      key={subspace.id}
      subspaceId={subspace.id}
      subspaceName={subspace.name}
      spaceName={space.name}
      base={base}
      onNavigate={navigate}
      show={show}
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
  show: (m: string, kind?: 'info' | 'success' | 'error') => void
  showError: (e: unknown) => void
}

function ChatViewInner({ subspaceId, subspaceName, base, onNavigate, show, showError }: Inner) {
  const history = useAsync(() => listMessages(subspaceId), [subspaceId])
  const [pending, setPending] = useState<{ text: string; citations: Citation[] } | null>(null)
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

  // Auto-scroll to bottom when messages arrive.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history.data, pending])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
    setPending(null)
  }, [])

  const send = useCallback(
    async (text: string, opts?: { regenerate?: boolean; images?: string[] }) => {
      const regenerate = opts?.regenerate ?? false
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
      setPending({ text: '', citations: [] })
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
          handleEvent(evt, setPending, (final, cits, messageId) => {
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
              id: messageId ?? `srv-${Date.now()}`,
              role: 'assistant',
              content: final,
              citations: cits.length ? cits : null,
              created_at: new Date().toISOString(),
            }
            history.setData((prev) => [...(prev ?? []), assistant])
            setPending(null)
          })
        }
      } catch (err) {
        if (!controller.signal.aborted) showError(err)
        setPending(null)
      } finally {
        setStreaming(false)
        abortRef.current = null
      }
    },
    [subspaceId, history, showError],
  )

  /* The notes agent asks before it writes; the other two don't.
     Not an inconsistency — a note is the one artifact here the student then
     *keeps and edits*, so its shape is worth a question. A quiz and a deck are
     regenerable in one click if the first attempt isn't useful. */
  const [noteBrief, setNoteBrief] = useState<{ topic?: string } | null>(null)
  const [writingNote, setWritingNote] = useState(false)

  const writeNote = useCallback(
    async (input: { topic?: string; instructions?: string }) => {
      setWritingNote(true)
      try {
        const note = await generateNote(subspaceId, input)
        setNoteBrief(null)
        show('Note written.', 'success')
        onNavigate(`${base}/notes?n=${note.id}`)
      } catch (err) {
        // The dialog stays open on failure, holding what was typed — a rate
        // limit or a dropped connection shouldn't cost the student the brief
        // they just wrote.
        showError(err)
      } finally {
        setWritingNote(false)
      }
    },
    [base, onNavigate, subspaceId, show, showError],
  )

  const runAgent = useCallback(
    async (agent: AgentKey, argument?: string) => {
      try {
        if (agent === 'quiz') {
          const quiz = await generateQuiz(subspaceId, {
            topic: clampTopic(argument, LIMITS.quizTopic),
            count: 5,
          })
          show('Quiz ready.', 'success')
          onNavigate(`${base}/quizzes?q=${quiz.id}`)
          return
        }
        if (agent === 'notes') {
          setNoteBrief({ topic: clampTopic(argument, LIMITS.noteTopic) })
          return
        }
        if (agent === 'flashcards') {
          // Seed from the last answer when there is one; otherwise let the
          // generator draw on whatever this topic has indexed.
          const summary = lastAssistant(history.data ?? [])
          const cards = await generateCards(subspaceId, {
            topic: clampTopic(
              argument || (summary ? firstSentence(summary.content, 60) : undefined),
              LIMITS.cardsTopic,
            ),
            source_text: summary?.content,
            count: 8,
          })
          show(`Wrote ${cards.length} cards.`, 'success')
          onNavigate(`${base}/flashcards`)
          return
        }
      } catch (err) {
        showError(err)
      }
    },
    [base, history.data, onNavigate, subspaceId, show, showError],
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
  const [dockPanel, setDockPanel] = useState<DockPanel>(null)

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
  const isEmpty = !history.loading && messages.length === 0 && !pending
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
        <SubspaceHeader
          activeTab={dockPanel ?? 'chat'}
          onSelectTab={(tab) => {
            // Chat closes whatever is open; the others swap the dock. Only
            // intercepted on wide screens — below `lg` the dock is not
            // rendered at all, so these must stay real navigation or the tabs
            // would silently do nothing on a phone.
            if (window.innerWidth < 1024) return false
            setDockPanel(tab === 'chat' ? null : tab)
            return true
          }}
        />

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
              description="Upload a PDF in the Docs tab, then ask a question. Answers cite the pages they came from."
            />
          )}

          {messages.map((m, i) => (
            <ChatMessage
              key={m.id}
              message={m}
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

          {pending && (
            <ChatMessage
              message={{
                id: 'pending',
                role: 'assistant',
                content: pending.text || '…',
                citations: pending.citations,
                created_at: new Date().toISOString(),
              }}
            />
          )}
          </div>
        </div>

        {/* Only below lg, where the dock isn't there to say it. */}
        <ActiveSkillStrip subspaceId={subspaceId} base={base} />

        <Composer
          placeholder={`Ask about ${subspaceName}…`}
          onSend={send}
          onCancel={cancel}
          onRunAgent={runAgent}
          streaming={streaming}
        />
      </div>

      <ContextDock
        subspaceId={subspaceId}
        base={base}
        onRunAgent={runAgent}
        panel={dockPanel}
        onClosePanel={() => setDockPanel(null)}
      />

      <NoteBriefDialog
        open={noteBrief !== null}
        topic={noteBrief?.topic}
        busy={writingNote}
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

function handleEvent(
  evt: ChatStreamEvent,
  setPending: (fn: (prev: { text: string; citations: Citation[] } | null) => { text: string; citations: Citation[] }) => void,
  onDone: (finalText: string, citations: Citation[], messageId: string | null) => void,
) {
  if (evt.type === 'token') {
    setPending((prev) => ({
      text: (prev?.text ?? '') + evt.delta,
      citations: prev?.citations ?? [],
    }))
    return
  }
  if (evt.type === 'citation') {
    setPending((prev) => ({
      text: prev?.text ?? '',
      citations: dedupeCitations([...(prev?.citations ?? []), evt.citation]),
    }))
    return
  }
  if (evt.type === 'done') {
    setPending((prev) => {
      const resolved = resolveDone(evt, prev)
      onDone(resolved.text, resolved.citations, evt.messageId)
      return { text: '', citations: [] }
    })
    return
  }
  if (evt.type === 'error') {
    throw new Error(evt.message)
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

