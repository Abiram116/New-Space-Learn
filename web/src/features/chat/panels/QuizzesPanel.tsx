/**
 * Quizzes, in the dock — taken here, scored here.
 *
 * The previous version said "taking a quiz needs the full width" and listed
 * links out. It doesn't: a question, four choices and a verdict is a column,
 * and `QuizRunner` already renders at dock density. Sending someone to another
 * route to answer five questions cost them the conversation the quiz came from.
 *
 * The runner and results are the *same components* the full page uses, in
 * `compact` mode. Two implementations of "take a quiz" would drift, and the
 * dock one would be the neglected one.
 */

import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { generateQuiz, getQuiz, listQuizzes } from '../../../api/quizzes'
import type { Quiz, QuizResult } from '../../../api/types'
import { Icon } from '../../../components/ui/Icon'
import { Skeleton } from '../../../components/ui/Skeleton'
import { useToast } from '../../../components/ui/Toast'
import { Rise, Stagger } from '../../../components/ui/motion'
import { cn } from '../../../lib/cn'
import { useAsync } from '../../../lib/useAsync'
import { QuizResults } from '../../quizzes/QuizResults'
import { QuizRunner } from '../../quizzes/QuizRunner'

export function QuizzesPanel({ subspaceId, base }: { subspaceId: string; base: string }) {
  const quizzes = useAsync(() => listQuizzes(subspaceId), [subspaceId])
  const [active, setActive] = useState<Quiz | null>(null)
  const [finished, setFinished] = useState<{ result: QuizResult; answers: number[] } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const { show, showError } = useToast()

  const openQuiz = useCallback(
    async (id: string) => {
      setLoadingId(id)
      try {
        setActive(await getQuiz(id))
        setFinished(null)
      } catch (err) {
        showError(err)
      } finally {
        setLoadingId(null)
      }
    },
    [showError],
  )

  const generate = useCallback(async () => {
    setGenerating(true)
    try {
      const quiz = await generateQuiz(subspaceId, { count: 5 })
      await quizzes.refresh()
      setActive(quiz)
      setFinished(null)
      show('Quiz ready.', 'success')
    } catch (err) {
      showError(err)
    } finally {
      setGenerating(false)
    }
  }, [subspaceId, quizzes, show, showError])

  if (active && finished) {
    return (
      // `min-h-0` is load-bearing: QuizResults scrolls its review column, and
      // without it the flex parent grows instead and the dock's own scroll
      // takes over — which is the bug this whole screen was reported for.
      <div className="flex min-h-0 flex-1 flex-col">
        <QuizResults
          compact
          quiz={active}
          answers={finished.answers}
          result={finished.result}
          onRetake={() => {
            setFinished(null)
            setAttempt((n) => n + 1)
          }}
          onBack={() => {
            setActive(null)
            setFinished(null)
          }}
        />
      </div>
    )
  }

  if (active) {
    return (
      <div className="-mr-1 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
        <QuizRunner
          key={attempt}
          compact
          quiz={active}
          onFinished={(result, answers) => {
            setFinished({ result, answers })
            void quizzes.refresh()
          }}
          onExit={() => setActive(null)}
        />
      </div>
    )
  }

  const list = quizzes.data ?? []

  return (
    <Rise distance={6} className="flex min-h-0 flex-col gap-3">
      <button
        type="button"
        onClick={generate}
        disabled={generating}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2',
          'text-[12.5px] font-semibold transition-all duration-200 cursor-pointer',
          generating
            ? 'cursor-default bg-line-soft text-muted'
            : 'bg-brand text-[#1a120f] hover:brightness-110 active:scale-[0.98]',
        )}
      >
        <Icon name="sparkle" size={12} />
        {generating ? 'Writing questions…' : 'Quiz me on this chat'}
      </button>

      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {quizzes.loading ? (
          <Skeleton className="h-12 rounded-[10px]" />
        ) : list.length === 0 ? (
          <p className="text-[12px] text-muted">None yet.</p>
        ) : (
          <Stagger step={18} max={140}>
            {list.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => openQuiz(q.id)}
                disabled={loadingId === q.id}
                className="flex w-full items-center gap-2 rounded-[10px] border border-line bg-raised px-2.5 py-2 text-left transition-colors cursor-pointer hover:border-brand/40"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">
                  {q.topic || 'Quiz'}
                </span>
                <span className="setcode shrink-0">
                  {loadingId === q.id ? '…' : `${q.questions.length}q`}
                </span>
              </button>
            ))}
          </Stagger>
        )}
      </div>

      <Link
        to={`${base}/quizzes`}
        className="flex items-center justify-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-[12px] text-muted transition-colors hover:border-brand/40 hover:text-brand-deep"
      >
        All quizzes <Icon name="arrowRight" size={12} />
      </Link>
    </Rise>
  )
}
