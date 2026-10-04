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
import { generateQuiz, getQuiz, listQuizzes } from '../../../api/quizzes'
import type { Quiz, QuizResult } from '../../../api/types'
import { Icon } from '../../../components/ui/Icon'
import { Skeleton } from '../../../components/ui/Skeleton'
import { useToast } from '../../../components/ui/Toast'
import { Stagger } from '../../../components/ui/motion'
import { StudyAmbience } from '../../../components/celebrate'
import { useAsync } from '../../../lib/useAsync'
import { QuizResults } from '../../quizzes/QuizResults'
import { QuizRunner } from '../../quizzes/QuizRunner'
import { DockAction, DockEmpty, DockSectionHead } from '../dockParts'

export function QuizzesPanel({ subspaceId }: { subspaceId: string; base?: string }) {
  const quizzes = useAsync(() => listQuizzes(subspaceId), [subspaceId], `quizzes:${subspaceId}`)
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

  if (active) {
    return (
      // One room for the runner AND its results, so the light carries across
      // the finish instead of restarting. The frame never scrolls; the runner
      // scrolls inside it. On results `min-h-0` is load-bearing: QuizResults
      // scrolls its own review column, and without it the flex parent grows
      // instead and the dock's own scroll takes over.
      <StudyAmbience compact innerClassName={finished ? undefined : '-mr-1 overflow-y-auto pr-1'}>
        {finished ? (
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
        ) : (
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
        )}
      </StudyAmbience>
    )
  }

  const list = weakestFirst(quizzes.data ?? [])

  return (
    // `flex-1`, not `min-h-full`. A percentage min-height has to resolve
    // against an ancestor chain of definite heights, and one scroll container
    // in that chain is enough to collapse it back to content height — which is
    // why this panel kept bunching into a strip at the top of the dock. Being a
    // flex item that grows needs nothing from its ancestors.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DockSectionHead id="quizzes-panel-label">{list.length > 0 ? `Quizzes · ${list.length}` : 'Quizzes'}</DockSectionHead>

      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {quizzes.loading ? (
          <Skeleton className="h-12 rounded-[10px]" />
        ) : quizzes.error ? (
          // A failed fetch used to fall through to `list.length === 0` and
          // read as "you've never generated a quiz here" — silently wrong.
          <p className="text-[12px] text-coral-deep">{quizzes.error}</p>
        ) : list.length === 0 ? (
          <DockEmpty icon="quiz" title="No quizzes yet">
            Make one from your files and it shows up here.
          </DockEmpty>
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
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold leading-snug text-ink">
                    {q.topic || 'Quiz'}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">
                    {loadingId === q.id ? 'Opening…' : quizMeta(q)}
                  </span>
                </span>
                {typeof q.best_score === 'number' && q.best_score < 100 ? (
                  <span className="setcode shrink-0 text-ink-3">Retake</span>
                ) : (
                  <Icon name="chevronRight" size={14} className="shrink-0 text-faint" />
                )}
              </button>
            ))}
          </Stagger>
        )}
      </div>

      <DockAction busy={generating} busyLabel="Writing questions…" onClick={generate}>
        Make a quiz
      </DockAction>
    </div>
  )
}

/** "5 questions · best 80%" — what a quiz is and how you did, not a bare "5q". */
function quizMeta(q: Quiz): string {
  const n = q.questions.length
  const parts = [`${n} question${n === 1 ? '' : 's'}`]
  if (typeof q.best_score === 'number') parts.push(`best ${Math.round(q.best_score)}%`)
  return parts.join(' · ')
}

/** Never taken first, then the ones you did worst on: what's worth another go leads. */
function weakestFirst(list: Quiz[]): Quiz[] {
  const rank = (q: Quiz) => (typeof q.best_score === 'number' ? q.best_score : -1)
  return [...list].sort((a, b) => rank(a) - rank(b))
}
