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
import { useNavigate } from 'react-router-dom'
import { listMessages, streamChat, type ChatStreamEvent } from '../../api/chat'
import { createDeck, createCard } from '../../api/flashcards'
import { createNote } from '../../api/notes'
import { generateQuiz } from '../../api/quizzes'
import type { ChatMessage as Message, Citation } from '../../api/types'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { useToast } from '../../components/ui/Toast'
import { useActiveSubspace } from '../../lib/nav'
import { useAsync } from '../../lib/useAsync'
import { SubspaceMissing } from '../spaces/SubspaceMissing'
import { ChatMessage } from './ChatMessage'
import { Composer } from './Composer'
import { ContextDock } from './ContextDock'
import type { AgentKey } from './agents'

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
    async (text: string) => {
      const optimistic: Message = {
        id: `tmp-${Date.now()}`,
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
      }
      history.setData((prev) => [...(prev ?? []), optimistic])
      setPending({ text: '', citations: [] })
      setStreaming(true)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        for await (const evt of streamChat(subspaceId, text, controller.signal)) {
          handleEvent(evt, setPending, (final, cits) => {
            const assistant: Message = {
              id: `srv-${Date.now()}`,
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

  const runAgent = useCallback(
    async (agent: AgentKey, argument?: string) => {
      try {
        if (agent === 'skills') {
          onNavigate(`${base}/skills`)
          return
        }
        if (agent === 'quiz') {
          const quiz = await generateQuiz(subspaceId, { topic: argument, count: 5 })
          show('Quiz ready.', 'success')
          onNavigate(`${base}/quizzes?q=${quiz.id}`)
          return
        }
        if (agent === 'notes') {
          const summary = lastAssistant(history.data ?? [])
          if (!summary) {
            show('Ask the AI something first, then run /notes.', 'info')
            return
          }
          const note = await createNote(subspaceId, {
            title: argument || derivedTitle(summary.content) || 'Note from chat',
            body_md: summary.content,
            origin: 'agent',
          })
          show('Note saved.', 'success')
          onNavigate(`${base}/notes?n=${note.id}`)
          return
        }
        if (agent === 'flashcards') {
          const summary = lastAssistant(history.data ?? [])
          if (!summary) {
            show('Ask the AI something first, then run /flashcards.', 'info')
            return
          }
          const deck = await createDeck(subspaceId, {
            name: argument || derivedTitle(summary.content) || 'From chat',
          })
          const [front, ...rest] = summary.content.split(/\n\s*\n/, 2)
          await createCard(deck.id, {
            front: front.slice(0, 200),
            back: rest.join('\n\n') || summary.content,
          })
          show('Deck created with 1 card. Add more from the deck view.', 'success')
          onNavigate(`${base}/flashcards`)
          return
        }
      } catch (err) {
        showError(err)
      }
    },
    [base, history.data, onNavigate, subspaceId, show, showError],
  )

  const messages = history.data ?? []
  const isEmpty = !history.loading && messages.length === 0 && !pending

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <SubspaceHeader />

        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-5"
        >
          {history.loading && <PageSpinner />}
          {history.error && !history.loading && (
            <div className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
              {history.error}
            </div>
          )}
          {isEmpty && (
            <EmptyState
              icon="💬"
              title={`Start learning ${subspaceName}`}
              description="Upload a PDF in the Docs tab, then ask a question. Answers cite the pages they came from."
            />
          )}

          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} />
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

        <Composer
          placeholder={`Ask about ${subspaceName}…`}
          onSend={send}
          onCancel={cancel}
          onRunAgent={runAgent}
          streaming={streaming}
        />
      </div>

      <ContextDock subspaceId={subspaceId} base={base} onRunAgent={runAgent} />
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function handleEvent(
  evt: ChatStreamEvent,
  setPending: (fn: (prev: { text: string; citations: Citation[] } | null) => { text: string; citations: Citation[] }) => void,
  onDone: (finalText: string, citations: Citation[]) => void,
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
      const finalText = (prev?.text ?? '').trim() || '(no reply)'
      onDone(finalText, evt.citations.length ? evt.citations : (prev?.citations ?? []))
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

function lastAssistant(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i]
  }
  return null
}

function derivedTitle(body: string): string {
  const firstLine = body.split(/\n/, 1)[0] ?? ''
  return firstLine.slice(0, 60).trim()
}
