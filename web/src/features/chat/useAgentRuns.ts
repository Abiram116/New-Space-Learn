/**
 * One place that owns "an agent is running".
 *
 * Make cards, Make a quiz and Save a note are reachable from three surfaces
 * (the dock, the mobile strip, and the composer's slash commands) and each
 * takes a second or two to come back — cold API, model call, insert. Before
 * this, all three were fire-and-forget: the UI sat unchanged until the
 * request resolved and a redirect happened, which reads as "nothing
 * happened". Every entry point now goes through `start`, so each gets the
 * same three things for free: a `busy` flag for the button, a progress card
 * in the thread, and a visible success/failure state.
 *
 * The state transitions are a plain reducer so they can be tested without a
 * DOM or a network.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { friendlyMessage } from '../../api/errors'
import { generateCards } from '../../api/flashcards'
import { generateNote } from '../../api/notes'
import { generateQuiz } from '../../api/quizzes'
import { deckHref, quizHref } from '../../lib/fromChat'
import { LIMITS } from '../../lib/limits'
import type { AgentKey } from './agents'

/** How long the success state stays visible before the redirect. */
export const REDIRECT_DELAY_MS = 600
export const CARD_COUNT = 8
export const QUIZ_COUNT = 5

export type AgentRunStatus = 'running' | 'done' | 'error'

export type AgentRun = {
  id: number
  agent: AgentKey
  status: AgentRunStatus
  startedAt: number
  /** Present tense, shown while running: "Making 8 flashcards from this answer…" */
  title: string
  /** Shown on success: "8 cards ready". */
  doneText?: string
  /** How many items the run actually made (cards, questions), when known —
   *  the only number the agent's success line may say. */
  count?: number
  href?: string
  error?: string
}

export type AgentRunInput = { topic?: string; instructions?: string }

type Action =
  | { type: 'start'; run: AgentRun }
  | { type: 'done'; id: number; doneText: string; href: string; count?: number }
  | { type: 'fail'; id: number; error: string }
  | { type: 'restart'; id: number; startedAt: number }
  | { type: 'dismiss'; id: number }

export function agentRunsReducer(state: AgentRun[], action: Action): AgentRun[] {
  switch (action.type) {
    case 'start':
      // A finished card is history the moment a new run begins — keeping a
      // stack of old "Done" cards in the thread is noise, not information.
      return [...state.filter((r) => r.status === 'running'), action.run]
    case 'done':
      return state.map((r) =>
        r.id === action.id
          ? { ...r, status: 'done', doneText: action.doneText, href: action.href, count: action.count, error: undefined }
          : r,
      )
    case 'fail':
      return state.map((r) =>
        r.id === action.id ? { ...r, status: 'error', error: action.error } : r,
      )
    case 'restart':
      return state.map((r) =>
        r.id === action.id
          ? { ...r, status: 'running', startedAt: action.startedAt, error: undefined }
          : r,
      )
    case 'dismiss':
      return state.filter((r) => r.id !== action.id)
  }
}

/** Which agents currently have a request in flight — drives the buttons. */
export function busyAgents(runs: AgentRun[]): Record<AgentKey, boolean> {
  const busy: Record<AgentKey, boolean> = { notes: false, quiz: false, flashcards: false }
  for (const r of runs) if (r.status === 'running') busy[r.agent] = true
  return busy
}

/** The first line of the progress card, before we know the outcome. */
export function progressTitle(
  agent: AgentKey,
  input: AgentRunInput,
  hasSourceText: boolean,
): string {
  const topic = input.topic?.trim()
  if (agent === 'flashcards') {
    const from = topic ? `on “${topic}”` : hasSourceText ? 'from this answer' : 'from this topic'
    return `Making ${CARD_COUNT} flashcards ${from}…`
  }
  if (agent === 'quiz') {
    return topic
      ? `Writing a ${QUIZ_COUNT}-question quiz on “${topic}”…`
      : `Writing a ${QUIZ_COUNT}-question quiz from this topic…`
  }
  return topic ? `Writing a note on “${topic}”…` : 'Writing your note…'
}

/** Slash-command / dock argument, cut to what the endpoint accepts. The
 *  composer is 4000 chars and every `topic` field is 120–140. */
export function clampTopic(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

const TOPIC_LIMIT: Record<AgentKey, number> = {
  quiz: LIMITS.quizTopic,
  notes: LIMITS.noteTopic,
  flashcards: LIMITS.cardsTopic,
}

type Outcome = { doneText: string; href: string; count?: number }

export function useAgentRuns({
  subspaceId,
  base,
  navigate,
  getSourceText,
}: {
  subspaceId: string
  base: string
  navigate: (to: string) => void
  /** The last assistant answer, used to seed a deck. Read lazily at click. */
  getSourceText: () => string | undefined
}) {
  const [runs, dispatch] = useReducer(agentRunsReducer, [])
  const nextId = useRef(1)
  const jobs = useRef(new Map<number, { agent: AgentKey; input: AgentRunInput; source?: string }>())
  const redirects = useRef(new Map<number, number>())
  const inFlight = useRef(new Set<AgentKey>())
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    const timers = redirects.current
    return () => {
      live.current = false
      for (const t of timers.values()) window.clearTimeout(t)
      timers.clear()
    }
  }, [])

  // The API call for each agent, in one table.
  const call = useCallback(
    async (agent: AgentKey, input: AgentRunInput, source?: string): Promise<Outcome> => {
      if (agent === 'quiz') {
        const quiz = await generateQuiz(subspaceId, {
          topic: input.topic,
          count: QUIZ_COUNT,
        })
        return {
          doneText: 'Quiz ready',
          href: quizHref(base, quiz.id),
          count: Array.isArray(quiz.questions) ? quiz.questions.length : undefined,
        }
      }
      if (agent === 'notes') {
        const note = await generateNote(subspaceId, {
          topic: input.topic,
          instructions: input.instructions?.trim() || undefined,
        })
        return { doneText: 'Note saved', href: `${base}/notes?n=${note.id}` }
      }
      // `topic` is only set when the student typed one — the backend titles the
      // deck itself otherwise. Seeding it from the answer text is how decks used
      // to end up named "We're working on the topic of…".
      const cards = await generateCards(subspaceId, {
        topic: input.topic,
        source_text: source,
        count: CARD_COUNT,
      })
      return {
        doneText: `${cards.length} card${cards.length === 1 ? '' : 's'} ready`,
        count: cards.length,
        // Land on the deck itself, as notes and quizzes land on what they wrote.
        href: cards[0] ? deckHref(base, cards[0].deck_id) : `${base}/flashcards`,
      }
    },
    [subspaceId, base],
  )

  const execute = useCallback(
    async (id: number) => {
      const job = jobs.current.get(id)
      if (!job) return
      const { agent, input, source } = job
      inFlight.current.add(agent)
      try {
        const outcome = await call(agent, input, source)
        // Dismissed while it was running: the student walked away from it.
        if (!live.current || !jobs.current.has(id)) return
        dispatch({ type: 'done', id, ...outcome })
        const timer = window.setTimeout(() => {
          redirects.current.delete(id)
          navigate(outcome.href)
        }, REDIRECT_DELAY_MS)
        redirects.current.set(id, timer)
      } catch (err) {
        if (live.current && jobs.current.has(id)) dispatch({ type: 'fail', id, error: friendlyMessage(err) })
      } finally {
        inFlight.current.delete(agent)
      }
    },
    [call, navigate],
  )

  const start = useCallback(
    (agent: AgentKey, raw: AgentRunInput = {}) => {
      const input = { ...raw, topic: clampTopic(raw.topic, TOPIC_LIMIT[agent]) }
      // The button is disabled while busy, but a slash command can still
      // land here, and two clicks can beat a re-render.
      if (inFlight.current.has(agent)) return
      const source = agent === 'flashcards' ? getSourceText() : undefined
      const id = nextId.current++
      jobs.current.set(id, { agent, input, source })
      inFlight.current.add(agent)
      dispatch({
        type: 'start',
        run: {
          id,
          agent,
          status: 'running',
          startedAt: Date.now(),
          title: progressTitle(agent, input, Boolean(source)),
        },
      })
      void execute(id)
    },
    [execute, getSourceText],
  )

  const retry = useCallback(
    (id: number) => {
      const job = jobs.current.get(id)
      if (!job || inFlight.current.has(job.agent)) return
      dispatch({ type: 'restart', id, startedAt: Date.now() })
      void execute(id)
    },
    [execute],
  )

  const dismiss = useCallback((id: number) => {
    const t = redirects.current.get(id)
    if (t) window.clearTimeout(t)
    redirects.current.delete(id)
    jobs.current.delete(id)
    dispatch({ type: 'dismiss', id })
  }, [])

  /** Go now instead of waiting out the success beat. */
  const open = useCallback(
    (id: number, href: string) => {
      const t = redirects.current.get(id)
      if (t) window.clearTimeout(t)
      redirects.current.delete(id)
      navigate(href)
    },
    [navigate],
  )

  return { runs, busy: busyAgents(runs), start, retry, dismiss, open }
}
