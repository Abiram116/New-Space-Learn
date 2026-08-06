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
import { clearStatsCache } from '../../lib/briefCache'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Card, DashedCard } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon } from '../../components/ui/Icon'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { CountUp, Stagger } from '../../components/ui/motion'
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
      <DashedCard
        onClick={onGenerate}
        className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 text-[13px] transition-colors hover:border-sky/50 hover:text-sky-deep"
      >
        <Icon name="sparkle" size={20} />
        Generate another
      </DashedCard>
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
      // The quiz average and streak just changed — see clearStatsCache.
      clearStatsCache()
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:flex-row lg:items-start lg:gap-8">
      <div className="flex w-full max-w-2xl flex-col gap-6">
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

      {/* Jump to any question directly — real use of the extra width, not decoration. */}
      <aside className="hidden w-full shrink-0 flex-col gap-2 lg:sticky lg:top-6 lg:flex lg:w-48">
        <span className="setcode px-0.5">Questions</span>
        <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-4">
          {quiz.questions.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={cn(
                'flex h-9 items-center justify-center rounded-lg text-xs font-bold transition-colors cursor-pointer',
                i === index
                  ? 'bg-brand text-white'
                  : answers[i] !== -1
                    ? 'bg-brand-soft text-brand-deep'
                    : 'border border-line text-faint hover:border-brand/40',
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </aside>
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8 lg:flex-row lg:items-start lg:gap-6">
      <Card className="flex shrink-0 flex-col gap-3 p-5 lg:sticky lg:top-6 lg:w-64">
        {/* The score is the moment this screen exists for — it counts up. */}
        <div className={cn('font-display text-5xl font-semibold', scoreClass)}>
          <CountUp value={result.score} />%
        </div>
        <div className="text-sm text-muted">
          {result.correct.filter(Boolean).length} of {quiz.questions.length} correct
        </div>
      </Card>

      {/* Reviewed questions arrive in order rather than all at once, so the
          eye has somewhere to start. Capped stagger — see ui/motion. */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
      <Stagger step={45}>
      {quiz.questions.map((q, i) => {
        const chose = answers[i]
        const correct = result.correct[i]
        return (
          <Card key={i} className="flex flex-col gap-2.5 p-4">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                  correct ? 'bg-mint text-white' : 'bg-coral-deep text-white',
                )}
              >
                <Icon name={correct ? 'check' : 'close'} size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{q.q}</div>
                {q.subtopic && (
                  <span className="setcode mt-0.5 inline-block text-sky-deep">{q.subtopic}</span>
                )}
              </div>
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
      </Stagger>
      </div>
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
