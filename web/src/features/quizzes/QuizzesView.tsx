/**
 * Quizzes: list past quizzes, generate a new one, take it, see the score.
 *
 * The view stays inside the URL — a `?q=<id>` param picks which quiz is open.
 * The three sub-modes (list / taking / results) render inside the same page
 * so back-nav works and the sidebar stays.
 */

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { generateQuiz, getQuiz, listQuizzes } from '../../api/quizzes'
import type { Quiz, QuizResult } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon } from '../../components/ui/Icon'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'

import { PageSpinner } from '../../components/ui/PageSpinner'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { useActiveSubspace } from '../../lib/nav'
import { useAsync } from '../../lib/useAsync'
import { SubspaceMissing } from '../spaces/SubspaceMissing'
import { QuizRunner } from './QuizRunner'
import { QuizResults } from './QuizResults'

export function QuizzesView() {
  const { space, subspace } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return <Inner subspaceId={subspace.id} />
}

function Inner({ subspaceId }: { subspaceId: string }) {
  const [params, setParams] = useSearchParams()
  const { show, showError } = useToast()
  const quizzes = useAsync(() => listQuizzes(subspaceId), [subspaceId], `quizzes:${subspaceId}`)
  const [activeId, setActiveId] = useState<string | null>(params.get('q'))
  const [generating, setGenerating] = useState(false)
  const [genOpen, setGenOpen] = useState(false)

  useEffect(() => {
    setActiveId(params.get('q'))
  }, [params])

  const startQuiz = useCallback(
    (id: string) => {
      setActiveId(id)
      setParams({ q: id }, { replace: true })
    },
    [setParams],
  )

  const back = useCallback(() => {
    setActiveId(null)
    setParams({}, { replace: true })
  }, [setParams])

  const generate = useCallback(
    async (topic: string, count: number) => {
      setGenerating(true)
      try {
        const quiz = await generateQuiz(subspaceId, { topic: topic || undefined, count })
        setGenOpen(false)
        await quizzes.refresh()
        startQuiz(quiz.id)
      } catch (err) {
        showError(err)
      } finally {
        setGenerating(false)
      }
    },
    [quizzes, startQuiz, subspaceId, showError],
  )

  if (activeId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <SubspaceHeader
          title="Quizzes"
          actions={
            <Button variant="secondary" onClick={back}>
              All quizzes
            </Button>
          }
        />
        <QuizSession
          quizId={activeId}
          onBack={back}
          onDone={() => {
            show('Answers submitted.', 'success')
            void quizzes.refresh()
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader
        title="Quizzes"
        actions={
          <Button onClick={() => setGenOpen(true)} disabled={generating}>
            <Icon name="sparkle" size={14} />
            {generating ? 'Generating…' : 'Generate quiz'}
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6">
        <QuizList
          quizzes={quizzes.data}
          loading={quizzes.loading}
          error={quizzes.error}
          onOpen={startQuiz}
          onGenerate={() => setGenOpen(true)}
        />
      </div>

      <GenerateQuizModal
        open={genOpen}
        busy={generating}
        onClose={() => setGenOpen(false)}
        onGenerate={generate}
      />
    </div>
  )
}

function QuizList({
  quizzes,
  loading,
  error,
  onOpen,
  onGenerate,
}: {
  quizzes: Quiz[] | null
  loading: boolean
  error: string | null
  onOpen: (id: string) => void
  onGenerate: () => void
}) {
  if (loading) {
    return (
      <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="mx-auto max-w-lg rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
        {error}
      </div>
    )
  }
  if (!quizzes || quizzes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-6">
        <EmptyState
          className="w-full max-w-lg"
          icon="quiz"
          title="No quizzes yet"
          description="Draw questions from what you've indexed in this topic, then find out what actually stuck."
          action={
            <Button size="lg" onClick={onGenerate}>
              <Icon name="sparkle" size={15} /> Generate a quiz
            </Button>
          }
        />
      </div>
    )
  }
  return (
    <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {quizzes.map((q) => (
        <button
          key={q.id}
          onClick={() => onOpen(q.id)}
          className="text-left cursor-pointer"
        >
          <Card className="flex h-full flex-col gap-2.5 p-4 transition-transform duration-200 hover:-translate-y-0.5 hover:ring-1 hover:ring-sky/30">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sky-soft text-sky-deep">
                <Icon name="quiz" size={13} />
              </span>
              <span className="setcode">Quiz</span>
            </div>
            <div className="nameplate text-[19px] leading-tight text-ink">
              {q.topic || 'Untitled topic'}
            </div>
            <div className="mt-auto flex items-baseline gap-1.5 border-t border-line pt-2">
              <span className="nameplate text-[22px] leading-none tabular-nums text-sky">
                {q.questions.length}
              </span>
              <span className="setcode">
                question{q.questions.length === 1 ? '' : 's'} ·{' '}
                {new Date(q.created_at).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            </div>
          </Card>
        </button>
      ))}
    </div>
  )
}


/**
 * Loads a quiz by id, then hands off to the shared runner and results.
 *
 * This file used to own both a ~180-line runner and a ~100-line results view.
 * They moved to `QuizRunner.tsx` / `QuizResults.tsx` so the chat dock can run
 * exactly the same quiz in a 320px column — two implementations of "take a
 * quiz" would drift, and the second one would be the neglected one.
 */
function QuizSession({
  quizId,
  onDone,
  onBack,
}: {
  quizId: string
  onDone: () => void
  onBack: () => void
}) {
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState<{ result: QuizResult; answers: number[] } | null>(
    null,
  )
  // Bumped on retake to remount the runner, which resets every answer and the
  // timer in one move rather than threading a reset through its internals.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setQuiz(null)
    setFinished(null)
    getQuiz(quizId)
      .then(setQuiz)
      .catch((err) => setError(friendlyMessage(err)))
  }, [quizId])

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">{error}</div>
      </div>
    )
  }
  if (!quiz) return <PageSpinner label="Loading quiz…" />

  if (finished) {
    return (
      <QuizResults
        quiz={quiz}
        answers={finished.answers}
        result={finished.result}
        onRetake={() => {
          setFinished(null)
          setAttempt((n) => n + 1)
        }}
        onBack={onBack}
      />
    )
  }

  return (
    <QuizRunner
      key={attempt}
      quiz={quiz}
      onFinished={(result, answers) => {
        setFinished({ result, answers })
        onDone()
      }}
      onExit={onBack}
    />
  )
}

function GenerateQuizModal({
  open,
  busy,
  onClose,
  onGenerate,
}: {
  open: boolean
  busy: boolean
  onClose: () => void
  onGenerate: (topic: string, count: number) => void
}) {
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(5)

  return (
    <Modal open={open} onClose={onClose} title="Generate a quiz" width="sm">
      <div className="flex flex-col gap-4">
        <Input
          label="Topic (optional)"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Attention basics"
          hint="Leave blank to cover the whole subspace."
        />
        <Input
          label="Questions"
          type="number"
          min={1}
          max={20}
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onGenerate(topic.trim(), count)} disabled={busy}>
            {busy ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
