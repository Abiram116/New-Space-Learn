/**
 * Quizzes: list past quizzes, generate a new one, take it, see the score.
 *
 * The view stays inside the URL — a `?q=<id>` param picks which quiz is open.
 * The three sub-modes (list / taking / results) render inside the same page
 * so back-nav works and the sidebar stays.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { generateQuiz, getQuiz, listQuizzes, submitQuiz } from '../../api/quizzes'
import type { Quiz, QuizResult } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { useAsync } from '../../lib/useAsync'
import { SubspaceMissing } from '../spaces/SubspaceMissing'

export function QuizzesView() {
  const { space, subspace } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return <Inner subspaceId={subspace.id} />
}

function Inner({ subspaceId }: { subspaceId: string }) {
  const [params, setParams] = useSearchParams()
  const { show, showError } = useToast()
  const quizzes = useAsync(() => listQuizzes(subspaceId), [subspaceId])
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
        <QuizRunner
          quizId={activeId}
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
            {generating ? 'Generating…' : '+ Generate quiz'}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
      <div className="mx-auto max-w-lg">
        <EmptyState
          icon="❓"
          title="No quizzes yet"
          description="Generate one from your uploaded docs, then knock out five questions."
          action={<Button onClick={onGenerate}>Generate a quiz</Button>}
        />
      </div>
    )
  }
  return (
    <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
      {quizzes.map((q) => (
        <button
          key={q.id}
          onClick={() => onOpen(q.id)}
          className="text-left cursor-pointer"
        >
          <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:border-brand-200">
            <div className="text-[11px] font-bold tracking-[0.09em] text-faint">QUIZ</div>
            <div className="font-display text-base font-semibold">
              {q.topic || 'Untitled topic'}
            </div>
            <div className="text-xs text-muted">
              {q.questions.length} question{q.questions.length === 1 ? '' : 's'} ·{' '}
              {new Date(q.created_at).toLocaleDateString()}
            </div>
          </Card>
        </button>
      ))}
    </div>
  )
}

function QuizRunner({ quizId, onDone }: { quizId: string; onDone: () => void }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<number[]>([])
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<QuizResult | null>(null)

  useEffect(() => {
    setQuiz(null)
    setResult(null)
    setError(null)
    setIndex(0)
    setAnswers([])
    getQuiz(quizId)
      .then((q) => {
        setQuiz(q)
        setAnswers(new Array(q.questions.length).fill(-1))
      })
      .catch((err) => setError(friendlyMessage(err)))
  }, [quizId])

  const chosen = answers[index]
  const canAdvance = chosen !== undefined && chosen !== -1
  const isLast = quiz ? index === quiz.questions.length - 1 : false

  const submit = async () => {
    if (!quiz) return
    setBusy(true)
    try {
      const r = await submitQuiz(quiz.id, answers)
      setResult(r)
      onDone()
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">{error}</div>
      </div>
    )
  }
  if (!quiz) return <PageSpinner label="Loading quiz…" />

  if (result) {
    return <QuizResults quiz={quiz} answers={answers} result={result} />
  }

  const q = quiz.questions[index]
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center gap-2 text-xs text-muted">
        Question {index + 1} of {quiz.questions.length}
        <div className="h-1 flex-1 rounded-full bg-line-soft">
          <div
            className="h-1 rounded-full bg-brand transition-all"
            style={{ width: `${((index + 1) / quiz.questions.length) * 100}%` }}
          />
        </div>
      </div>
      <div className="rounded-2xl border-[1.5px] border-line bg-surface p-6">
        <div className="text-[15px] font-medium leading-relaxed">{q.q}</div>
        <div className="mt-4 flex flex-col gap-2">
          {q.choices.map((choice, i) => (
            <button
              key={i}
              onClick={() =>
                setAnswers((prev) => {
                  const next = [...prev]
                  next[index] = i
                  return next
                })
              }
              className={cn(
                'flex items-center gap-3 rounded-xl border-[1.5px] px-3.5 py-3 text-left text-sm transition-colors cursor-pointer',
                answers[index] === i
                  ? 'border-brand bg-brand-soft'
                  : 'border-line bg-surface hover:border-brand-200',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                  answers[index] === i ? 'bg-brand text-white' : 'bg-line-soft text-muted',
                )}
              >
                {String.fromCharCode(65 + i)}
              </span>
              {choice}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-between">
        <Button
          variant="secondary"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          Back
        </Button>
        {isLast ? (
          <Button onClick={submit} disabled={!canAdvance || busy}>
            {busy ? 'Submitting…' : 'Submit quiz'}
          </Button>
        ) : (
          <Button
            onClick={() => setIndex((i) => Math.min(quiz.questions.length - 1, i + 1))}
            disabled={!canAdvance}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  )
}

function QuizResults({
  quiz,
  answers,
  result,
}: {
  quiz: Quiz
  answers: number[]
  result: QuizResult
}) {
  const scoreClass = useMemo(() => {
    if (result.score >= 80) return 'text-mint'
    if (result.score >= 60) return 'text-sky-deep'
    return 'text-coral-deep'
  }, [result.score])

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-8">
      <Card className="flex items-center gap-4 p-4">
        <div className={cn('font-display text-4xl font-semibold', scoreClass)}>
          {result.score}%
        </div>
        <div className="text-sm text-muted">
          {result.correct.filter(Boolean).length} of {quiz.questions.length} correct
        </div>
      </Card>

      {quiz.questions.map((q, i) => {
        const chose = answers[i]
        const correct = result.correct[i]
        return (
          <Card key={i} className="flex flex-col gap-2.5 p-4">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                  correct ? 'bg-mint text-white' : 'bg-coral-deep text-white',
                )}
              >
                {correct ? '✓' : '✗'}
              </span>
              <div className="text-sm font-medium">{q.q}</div>
            </div>
            <div className="flex flex-col gap-1 pl-8 text-sm">
              {q.choices.map((choice, ci) => (
                <div
                  key={ci}
                  className={cn(
                    'rounded-md px-2 py-1',
                    ci === q.answer_index && 'bg-mint-soft text-mint font-semibold',
                    ci === chose && ci !== q.answer_index && 'bg-coral-soft text-coral-deep',
                  )}
                >
                  {choice}
                  {ci === chose && ci !== q.answer_index && ' — your answer'}
                  {ci === q.answer_index && ' — correct'}
                </div>
              ))}
              {q.source && (
                <div className="mt-1 text-[11px] text-faint">source: {q.source}</div>
              )}
            </div>
          </Card>
        )
      })}
    </div>
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
