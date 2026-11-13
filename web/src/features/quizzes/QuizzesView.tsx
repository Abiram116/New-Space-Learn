/**
 * Quizzes: list past quizzes, generate a new one, take it, see the score.
 *
 * The view stays inside the URL — a `?q=<id>` param picks which quiz is open.
 * The three sub-modes (list / taking / results) render inside the same page
 * so back-nav works and the sidebar stays.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LIMITS } from '../../lib/limits'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { cameFromChat, returnToChat } from '../../lib/fromChat'
import {
  deleteQuiz,
  extendQuiz,
  generateQuiz,
  getQuiz,
  listAllQuizzes,
  renameQuiz,
  rewordQuiz,
  submitQuiz,
} from '../../api/quizzes'
import { generateCards } from '../../api/flashcards'
import type { Quiz, QuizResult, QuizReword, Tone } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon } from '../../components/ui/Icon'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'

import { PageSpinner } from '../../components/ui/PageSpinner'
import { Skeleton } from '../../components/ui/Skeleton'
import { SlowBot } from '../../components/mascot/SlowBot'
import { useToast } from '../../components/ui/Toast'
import { useSlugParam } from '../../lib/useSlugParam'
import { useTopicScope } from '../../lib/useTopicScope'
import { useAssessmentOptional } from '../../lib/assessment'
import { toneBar } from '../../lib/tone'
import { useAsync } from '../../lib/useAsync'
import { cn } from '../../lib/cn'
import { useSpaces } from '../spaces/SpacesProvider'
import { TopicScopeFallback } from '../spaces/TopicScopeFallback'
import { TopicSelect } from '../spaces/TopicSelect'
import { StudyAmbience } from '../../components/celebrate'
import { useIsMobile } from '../../lib/useIsMobile'
import { clearStatsCache } from '../../lib/briefCache'
import { RenameModal } from '../flashcards/modals'
import { PhoneQuizzes } from './PhoneQuizzes'
import { clearQuizDraft, growQuizDraft, hasQuizDraft } from './draft'
import { QuizRunner } from './QuizRunner'
import { QuizResults } from './QuizResults'
import { AddMoreModal } from './AddMoreModal'
import { RetakeChoice, RetakeSetting, type RetakeMode } from './RetakeChoice'
import {
  rememberSource,
  rememberedSource,
  SourcePicker,
  sourceBody,
  sourceReady,
  type PickedSource,
} from './SourcePicker'
import {
  clearVariant,
  findSimilarQuiz,
  fitsQuiz,
  loadVariant,
  retakeAskSwitch,
  retakeRewordSwitch,
  saveVariant,
  toStoredAnswers,
  toVariantCorrect,
  variantDraftKey,
  variantQuiz,
} from './variant'

/** The most questions one quiz grows to (`MAX_QUIZ_QUESTIONS` on the server),
 *  and the most added at once (`QuizExtend.count`). */
const QUIZ_MAX = 40
const ADD_MAX = 10

/** A quiz is named by its topic line ("Policy Iteration Basics"); `?q=` shows that, not the id. */
const quizName = (q: { topic: string | null }) => q.topic

/** The questions a student missed, with the right answer and why, as text. */
export function missedMaterial(quiz: Quiz, answers: number[]): string | undefined {
  const text = quiz.questions
    .map((q, i) => ({ q, i }))
    .filter(({ q, i }) => answers[i] !== q.answer_index)
    .map(({ q }) => `Q: ${q.q}\nAnswer: ${q.choices[q.answer_index]}${q.explanation ? `\nWhy: ${q.explanation}` : ''}`)
    .join('\n\n')
    .slice(0, 7900)
  return text || undefined
}

export function QuizzesView() {
  const { space, subspace, base, isGlobal } = useTopicScope()
  if (!space || !subspace) return <TopicScopeFallback isGlobal={isGlobal} section="quizzes" />
  return <Inner subspaceId={subspace.id} subspaceName={subspace.name} base={base} />
}

function Inner({
  subspaceId,
  subspaceName,
  base,
}: {
  subspaceId: string
  subspaceName: string
  base: string
}) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  // Opened from the chat sidebar: Back goes to that chat, not to this list.
  const fromChat = cameFromChat(params)
  const { show, showError } = useToast()
  const isMobile = useIsMobile()
  // Global on purpose — see the identical note on `listAllNotes` in
  // NotesView. `subspaceId` still decides which topic a NEW quiz draws its
  // material from; it no longer decides what's visible in the list.
  const quizzes = useAsync(() => listAllQuizzes(), [], 'quizzes:all')
  const { spaces, refresh: refreshSpaces } = useSpaces()
  const subspaceToSpace = useMemo(() => {
    const map = new Map<string, (typeof spaces)[number]>()
    for (const s of spaces) for (const sub of s.subspaces) map.set(sub.id, s)
    return map
  }, [spaces])
  const [subjectFilter, setSubjectFilter] = useState<string>('all')
  const subjectOptions = useMemo(
    () =>
      spaces.filter((s) =>
        (quizzes.data ?? []).some((q) => q.subspace_id && subspaceToSpace.get(q.subspace_id)?.id === s.id),
      ),
    [spaces, quizzes.data, subspaceToSpace],
  )
  const [generating, setGenerating] = useState(false)
  const [genOpen, setGenOpen] = useState(false)

  // The open quiz IS the `?q=` value, read as a name or an id (see `useSlugParam`).
  const quizParam = useSlugParam('q', quizzes.data, quizName, 'quiz', !quizzes.validating)
  const activeId = quizParam.id
  const slugForQuiz = quizParam.slugFor

  // How to take the quiz about to open, when the student already said so
  // (the "you already have this quiz" offer). Otherwise the session decides.
  const [intent, setIntent] = useState<{ id: string; mode: RetakeMode } | null>(null)
  const startQuiz = useCallback(
    (id: string, mode?: RetakeMode) => {
      setIntent(mode ? { id, mode } : null)
      setParams({ q: slugForQuiz(id) }, { replace: true })
    },
    [setParams, slugForQuiz],
  )

  const back = useCallback(() => {
    if (fromChat) returnToChat(navigate, base, 'quizzes')
    else setParams({}, { replace: true })
  }, [fromChat, navigate, base, setParams])

  // The page header's Back sits right above a quiz in progress. The quiz's own
  // Leave asks before throwing answers away (they are only sent on "See
  // results"), and so does every link in the app; this button did not.
  const unsaved = useAssessmentOptional()?.unsaved ?? false
  const [confirmBack, setConfirmBack] = useState(false)
  const headerBack = useCallback(() => {
    if (unsaved) setConfirmBack(true)
    else back()
  }, [unsaved, back])

  // One generation at a time: a second click before `generating` re-renders
  // would otherwise pay for, and create, a second quiz.
  const generatingRef = useRef(false)
  const generate = useCallback(
    async (topicId: string, topic: string, count: number, source: PickedSource) => {
      if (generatingRef.current) return
      generatingRef.current = true
      setGenerating(true)
      try {
        const quiz = await generateQuiz(topicId, { topic: topic || undefined, count, ...sourceBody(source) })
        rememberSource(source)
        setGenOpen(false)
        await quizzes.refresh()
        startQuiz(quiz.id)
      } catch (err) {
        showError(err)
      } finally {
        generatingRef.current = false
        setGenerating(false)
      }
    },
    [quizzes, startQuiz, showError],
  )

  // "Add more questions" to an existing quiz.
  const [addToId, setAddToId] = useState<string | null>(null)
  const addTo = quizzes.data?.find((q) => q.id === addToId) ?? null
  const addMore = async (count: number, source: PickedSource) => {
    if (!addTo) return
    const before = addTo.questions.length
    const updated = await extendQuiz(addTo.id, { count, ...sourceBody(source) })
    // An attempt in progress keeps its answers; the new questions are unanswered.
    growQuizDraft(updated.id, updated.questions.length)
    quizzes.setData((prev) =>
      prev ? prev.map((q) => (q.id === updated.id ? { ...q, questions: updated.questions } : q)) : prev,
    )
    const added = updated.questions.length - before
    setAddToId(null)
    show(
      added < count
        ? `Added ${added} of ${count} — the rest repeated what the quiz already asks.`
        : `Added ${added} question${added === 1 ? '' : 's'}.`,
      'success',
    )
  }

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const renaming = quizzes.data?.find((q) => q.id === renamingId) ?? null

  const removeQuiz = async () => {
    if (!deleteId) return
    const id = deleteId
    setDeleteId(null)
    quizzes.setData((prev) => (prev ? prev.filter((q) => q.id !== id) : prev))
    try {
      await deleteQuiz(id)
      clearQuizDraft(id)
      show('Quiz deleted.', 'success')
      // Its attempts went with it: Home's numbers and the topic's quiz count
      // (the phone hub, the sidebar) are both out of date now.
      clearStatsCache()
      void refreshSpaces?.()
    } catch (err) {
      showError(err)
      quizzes.refresh()
    }
  }

  const quizDialogs = (
    <>
      <RenameModal
        open={renaming !== null}
        title="Rename quiz"
        label="Quiz name"
        current={renaming?.topic ?? ''}
        maxLength={LIMITS.quizTopic}
        onClose={() => setRenamingId(null)}
        onSave={async (name) => {
          if (!renaming) return
          const updated = await renameQuiz(renaming.id, name)
          // Only the name: the list row also carries where the quiz lives.
          quizzes.setData((prev) =>
            prev ? prev.map((q) => (q.id === updated.id ? { ...q, topic: updated.topic } : q)) : prev,
          )
          setRenamingId(null)
          show('Quiz renamed.', 'success')
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Delete this quiz?"
        description="Your scores for it go too. This can't be undone."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleteId(null)}
        onConfirm={removeQuiz}
      />
      <AddMoreModal
        open={addTo !== null}
        kind="quiz"
        name={addTo?.topic || 'Untitled topic'}
        topicId={addTo?.subspace_id ?? subspaceId}
        max={Math.min(ADD_MAX, QUIZ_MAX - (addTo?.questions.length ?? 0))}
        onClose={() => setAddToId(null)}
        onAdd={addMore}
      />
    </>
  )

  // The topic a new quiz would draw on has no file yet: generating can only
  // fail, so the empty screen sends the student to add one first.
  const addMaterialHref =
    spaces.flatMap((sp) => sp.subspaces).find((sub) => sub.id === subspaceId)?.counts?.docs === 0
      ? `${base}/docs?add=1`
      : null

  // A readable link needs the list to say which quiz it means; an id doesn't.
  if (quizParam.pending) return <PageSpinner label="Opening your quiz…" />

  if (activeId && isMobile) {
    // No page header: the quiz stage brings its own slim top row, and the
    // shell's bars are hidden while it is up.
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <StudyAmbience compact innerClassName="overflow-y-auto">
          <QuizSession
            quizId={activeId}
            topicId={quizzes.data?.find((q) => q.id === activeId)?.subspace_id ?? null}
            intent={intent?.id === activeId ? intent.mode : null}
            base={base}
            onBack={back}
            backLabel={fromChat ? 'Back to chat' : undefined}
            onDone={() => {
              // No toast on a phone: the results screen says it, and the toast
              // would sit over its Back / Retake bar.
              void quizzes.refresh()
            }}
          />
        </StudyAmbience>
      </div>
    )
  }

  if (activeId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <SubspaceHeader
          title={quizzes.data?.find((q) => q.id === activeId)?.topic || 'Quiz'}
          breadcrumb={false}
          actions={
            <Button variant="secondary" onClick={headerBack}>
              <Icon name="arrowLeft" size={14} /> {fromChat ? 'Back to chat' : 'All quizzes'}
            </Button>
          }
        />
        <ConfirmDialog
          open={confirmBack}
          title="Leave this quiz?"
          description="Answers are only saved when you see your results, so this attempt won't count."
          confirmLabel="Leave quiz"
          destructive
          onCancel={() => setConfirmBack(false)}
          onConfirm={() => {
            setConfirmBack(false)
            // Leaving on purpose: the answers so far are given up, not kept.
            clearQuizDraft(activeId)
            back()
          }}
        />
        {/* The room the quiz is taken in — see components/celebrate/Ambience.
            The frame stays put; the session scrolls inside it, which also
            means a long question no longer runs off the bottom of the page. */}
        <StudyAmbience innerClassName="overflow-y-auto">
          <QuizSession
            quizId={activeId}
            topicId={quizzes.data?.find((q) => q.id === activeId)?.subspace_id ?? null}
            intent={intent?.id === activeId ? intent.mode : null}
            base={base}
            onBack={back}
            backLabel={fromChat ? 'Back to chat' : undefined}
            onDone={() => {
              show('Nice work! Your answers are in.', 'success')
              void quizzes.refresh()
            }}
          />
        </StudyAmbience>
      </div>
    )
  }

  const visibleQuizzes =
    subjectFilter === 'all'
      ? quizzes.data
      : (quizzes.data ?? []).filter(
          (q) => q.subspace_id && subspaceToSpace.get(q.subspace_id)?.id === subjectFilter,
        )

  // The retake setting only means something once a quiz has been taken.
  const anyTaken = (quizzes.data ?? []).some((q) => (q.attempts ?? 0) > 0 || q.best_score != null)

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PhoneQuizzes
          quizzes={visibleQuizzes}
          loading={quizzes.loading}
          error={quizzes.error}
          onRetry={quizzes.refresh}
          subjects={subjectOptions}
          subjectFilter={subjectFilter}
          onSubjectFilter={setSubjectFilter}
          toneOf={(q) => (q.subspace_id ? subspaceToSpace.get(q.subspace_id)?.tone : undefined)}
          generating={generating}
          addMaterialHref={addMaterialHref}
          onOpen={startQuiz}
          onRename={setRenamingId}
          onDelete={setDeleteId}
          onAddMore={setAddToId}
          onGenerate={() => setGenOpen(true)}
          retakeSetting={anyTaken}
        />
        {quizDialogs}
        <GenerateQuizModal
          open={genOpen}
          defaultTopicId={subspaceId}
          quizzes={quizzes.data}
          busy={generating}
          onClose={() => setGenOpen(false)}
          onGenerate={generate}
          onRetake={(id, mode) => {
            setGenOpen(false)
            startQuiz(id, mode)
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader
        title="Quizzes"
        // Quizzes is an account-wide library now (2026-08 audit) — see the
        // identical note on NotesView's own SubspaceHeader call.
        breadcrumb={false}
        actions={
          <Button onClick={() => setGenOpen(true)} disabled={generating}>
            <Icon name="sparkle" size={14} />
            {generating ? 'Making your quiz…' : 'Make a quiz'}
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6">
        {/* Only once quizzes span more than one subject — a single-subject
            library has nothing for this to narrow down. */}
        {(subjectOptions.length > 1 || anyTaken) && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {subjectOptions.length > 1 && (
              <Select
                value={subjectFilter}
                onChange={setSubjectFilter}
                ariaLabel="Filter by subject"
                className="max-w-xs"
                options={[
                  { value: 'all', label: 'All subjects' },
                  ...subjectOptions.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            )}
            {anyTaken && <RetakeSetting className="ml-auto" />}
          </div>
        )}
        <QuizList
          quizzes={visibleQuizzes}
          subspaceToSpace={subspaceToSpace}
          loading={quizzes.loading}
          error={quizzes.error}
          onOpen={startQuiz}
          onRename={setRenamingId}
          onDelete={setDeleteId}
          onAddMore={setAddToId}
          onGenerate={() => setGenOpen(true)}
          onAddMaterial={addMaterialHref ? () => navigate(addMaterialHref) : null}
          topicName={subspaceName}
          onRetry={quizzes.refresh}
        />
      </div>

      {quizDialogs}

      <GenerateQuizModal
        open={genOpen}
        defaultTopicId={subspaceId}
        quizzes={quizzes.data}
        busy={generating}
        onClose={() => setGenOpen(false)}
        onGenerate={generate}
        onRetake={(id, mode) => {
          setGenOpen(false)
          startQuiz(id, mode)
        }}
      />
    </div>
  )
}

function QuizList({
  quizzes,
  subspaceToSpace,
  loading,
  error,
  onOpen,
  onRename,
  onDelete,
  onAddMore,
  onGenerate,
  onAddMaterial,
  topicName,
  onRetry,
}: {
  quizzes: Quiz[] | null
  /** Resolves each quiz's subspace to its subject, for the Subject · Topic
   *  caption and accent bar — quizzes are a global list now (see the note
   *  in `Inner`), so a title alone no longer says where a quiz came from. */
  subspaceToSpace: Map<string, { id: string; name: string; tone: Tone }>
  loading: boolean
  error: string | null
  onOpen: (id: string) => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
  /** "Add more questions" to this quiz. */
  onAddMore: (id: string) => void
  onGenerate: () => void
  /** Set when the topic has no file yet: go and add one, instead of Generate. */
  onAddMaterial: (() => void) | null
  topicName: string
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <SlowBot pending agent="quiz" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-start gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
        <p>{error}</p>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
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
          bot={{ agent: 'quiz', say: 'emptyQuizzes' }}
          description={
            onAddMaterial
              ? `${topicName} has no material yet. Add a file and we'll make questions from it.`
              : "Get questions from your files in this topic and see what you remember."
          }
          action={
            onAddMaterial ? (
              <Button size="lg" onClick={onAddMaterial}>
                <Icon name="plus" size={15} /> Add material
              </Button>
            ) : (
              <Button size="lg" onClick={onGenerate}>
                <Icon name="sparkle" size={15} /> Generate a quiz
              </Button>
            )
          }
        />
      </div>
    )
  }
  return (
    <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {quizzes.map((q) => (
        <div key={q.id} className="group relative flex">
        <button
          onClick={() => onOpen(q.id)}
          className="flex-1 text-left cursor-pointer"
        >
          <Card className="flex h-full flex-col gap-2.5 p-4 transition-transform duration-200 hover:-translate-y-0.5 hover:ring-1 hover:ring-sky/30">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sky-soft text-sky-deep">
                <Icon name="quiz" size={13} />
              </span>
              <span className="setcode">Quiz</span>
              {/* The verb. The whole card is the button, but nothing on it said
                  so, and a quiz you have already taken reads differently from
                  one you haven't. Decoration only — the button keeps its name. */}
              <span
                aria-hidden
                className="setcode ml-auto text-sky-deep transition-[margin] group-focus-within:mr-[4.75rem] group-hover:mr-[4.75rem]"
              >
                {q.best_score != null ? 'Retake' : 'Start'} →
              </span>
            </div>
            <div className="nameplate text-[19px] leading-tight text-ink">
              {q.topic || 'Untitled topic'}
            </div>
            {(q.subject_name || q.subspace_name) && (
              <div className="-mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
                <span
                  aria-hidden
                  className={cn(
                    'h-2.5 w-[3px] shrink-0 rounded-full',
                    toneBar[(q.subspace_id && subspaceToSpace.get(q.subspace_id)?.tone) || 'brand'],
                  )}
                />
                <span className="truncate">
                  {q.subject_name}
                  {q.subject_name && q.subspace_name ? ' · ' : ''}
                  {q.subspace_name}
                </span>
              </div>
            )}
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
              {/* Only once the quiz has been taken — best of all attempts. */}
              {q.best_score != null && (
                <span className="setcode ml-auto shrink-0 tabular-nums text-mint-deep">
                  Best {q.best_score}%
                </span>
              )}
            </div>
          </Card>
        </button>
          {/* Housekeeping, out of the way until the tile is hovered or tabbed
              to; Start / Retake steps aside for it (see the margin above). */}
          <div className="absolute right-3 top-[15px] z-10 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {q.subspace_id && q.questions.length < QUIZ_MAX && (
              <button
                type="button"
                onClick={() => onAddMore(q.id)}
                aria-label={`Add questions to ${q.topic || 'Untitled topic'}`}
                title="Add more questions"
                className="rounded-md p-1 text-faint hover:text-ink"
              >
                <Icon name="plus" size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onRename(q.id)}
              aria-label={`Rename ${q.topic || 'Untitled topic'}`}
              className="rounded-md p-1 text-faint hover:text-ink"
            >
              <Icon name="pencil" size={14} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(q.id)}
              aria-label={`Delete ${q.topic || 'Untitled topic'}`}
              className="rounded-md p-1 text-faint hover:text-coral"
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        </div>
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
 *
 * A quiz taken before is a retake: exactly as before, or reworded (see
 * ./variant.ts and ./RetakeChoice.tsx). An attempt already in progress in
 * this tab always resumes as it was, whichever way it was being taken.
 */
function QuizSession({
  quizId,
  topicId,
  intent = null,
  base,
  onDone,
  onBack,
  backLabel = 'Back to quizzes',
}: {
  quizId: string
  /** The topic the quiz lives in, from the list; the quiz itself says so too. */
  topicId: string | null
  /** How to take it, when the student already said (from the generate dialog). */
  intent?: RetakeMode | null
  base: string
  onDone: () => void
  onBack: () => void
  /** What the way out is called: where it goes ("Back to chat" from the sidebar). */
  backLabel?: string
}) {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { show, showError } = useToast()
  const [madeDeckId, setMadeDeckId] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState<{ result: QuizResult; answers: number[] } | null>(
    null,
  )
  // Bumped on retake to remount the runner, which resets every answer and the
  // timer in one move rather than threading a reset through its internals.
  const [attempt, setAttempt] = useState(0)
  // Bumped by Retry: a quiz that failed to load is fetched again in place.
  const [reload, setReload] = useState(0)
  // 'choose': asking same-or-reworded. 'run': the runner (or results) is up.
  const [stage, setStage] = useState<'choose' | 'run'>('run')
  const [variant, setVariant] = useState<QuizReword | null>(null)
  const [rewording, setRewording] = useState(false)
  const [rewordError, setRewordError] = useState<string | null>(null)
  // The quiz on screen, for answers that arrive after the student moved on.
  const current = useRef(quizId)
  current.current = quizId

  const begin = useCallback(
    async (q: Quiz, mode: RetakeMode) => {
      setRewordError(null)
      setFinished(null)
      if (mode === 'same') {
        clearVariant(q.id)
        setVariant(null)
        setStage('run')
        setAttempt((n) => n + 1)
        return
      }
      setRewording(true)
      try {
        const reword = await rewordQuiz(q.id)
        if (current.current !== q.id) return
        // A reply that doesn't line up with the quiz (it changed meanwhile —
        // questions were added in another tab) is never run: same questions instead.
        if (!fitsQuiz(q, reword)) {
          show('The quiz changed while it was being reworded, so here it is as it is.', 'info')
          clearVariant(q.id)
          setVariant(null)
        } else {
          saveVariant(reword)
          setVariant(reword)
          if (reword.note) show(reword.note, 'info')
        }
        setStage('run')
        setAttempt((n) => n + 1)
      } catch (err) {
        if (current.current !== q.id) return
        // Out of quota, or offline: say so where the choice is, so "Same
        // questions" is right there.
        setRewordError(friendlyMessage(err))
        setStage('choose')
      } finally {
        setRewording(false)
      }
    },
    [show],
  )

  /** What happens when a taken quiz is (re)opened: ask, or do the usual. */
  const retake = useCallback(
    (q: Quiz) => {
      if (retakeAskSwitch.get()) {
        setFinished(null)
        setStage('choose')
      } else void begin(q, retakeRewordSwitch.get() ? 'reworded' : 'same')
    },
    [begin],
  )

  useEffect(() => {
    // Opening another quiz while one is still loading must not let the slow
    // answer overwrite the one now on screen.
    let live = true
    setQuiz(null)
    setFinished(null)
    setError(null)
    setVariant(null)
    setRewordError(null)
    setStage('run')
    getQuiz(quizId)
      .then((q) => {
        if (!live) return
        setQuiz(q)
        // An attempt in progress resumes as it was being taken.
        const kept = loadVariant(q)
        if (kept && hasQuizDraft(variantDraftKey(q.id))) {
          setVariant(kept)
          return
        }
        if (hasQuizDraft(q.id)) return
        if (intent) void begin(q, intent)
        else if ((q.attempts ?? 0) > 0) retake(q)
      })
      .catch((err) => live && setError(friendlyMessage(err)))
    return () => {
      live = false
    }
    // `intent` is read once, when the quiz opens; `begin`/`retake` are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId, reload])

  // A reworded attempt is scored against the stored quiz: answers mapped
  // back, verdicts mapped forward for the results screen.
  const submitVariant = useMemo(() => {
    if (!variant) return undefined
    return async (answers: number[], seconds: number) => {
      const result = await submitQuiz(variant.quiz_id, toStoredAnswers(variant.questions, answers), seconds)
      return { ...result, correct: toVariantCorrect(variant.questions, result.correct) }
    }
  }, [variant])

  if (error) {
    return (
      <div className="mx-auto w-full max-w-lg p-6">
        <div className="flex flex-col items-start gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
          <p>{error}</p>
          {/* A dropped connection used to be a dead end here: the only way to
              try again was to leave and open the quiz a second time. */}
          <Button size={isMobile ? 'lg' : 'sm'} variant="secondary" onClick={() => setReload((n) => n + 1)}>
            Retry
          </Button>
        </div>
        {/* The phone has no page header to go back with. */}
        {isMobile && (
          <Button variant="secondary" size="lg" className="mt-3 w-full" onClick={onBack}>
            {backLabel}
          </Button>
        )}
      </div>
    )
  }
  if (!quiz) return <PageSpinner label="Opening your quiz…" />
  // No choice screen yet, but a rewording on its way (the remembered
  // preference, or "take it reworded" from the generate dialog).
  if (rewording && stage !== 'choose') return <PageSpinner label="Rewording the questions…" />

  if (stage === 'choose') {
    return (
      <RetakeChoice
        quiz={quiz}
        busy={rewording}
        error={rewordError}
        onPick={(mode) => void begin(quiz, mode)}
        onBack={onBack}
        backLabel={backLabel}
        phone={isMobile}
      />
    )
  }

  const shown = variant ? variantQuiz(quiz, variant) : quiz

  if (finished) {
    // New cards go in the quiz's own topic, drawn from that topic's material.
    const cardsTopicId = quiz.subspace_id ?? topicId
    return (
      <QuizResults
        quiz={shown}
        answers={finished.answers}
        result={finished.result}
        missedCards={
          cardsTopicId
            ? {
                onMake: async (focus, count) => {
                  try {
                    const cards = await generateCards(cardsTopicId, {
                      topic: focus,
                      count,
                      // The cards are about what THIS quiz got wrong, so the
                      // missed questions are the material. Left to search the
                      // topic's files instead, a quiz made from a note came
                      // back as cards about something else entirely.
                      source_text: missedMaterial(shown, finished.answers),
                      deck_name: `Missed: ${quiz.topic || 'quiz'}`.slice(0, LIMITS.deckName),
                    })
                    if (!cards[0]) return false
                    setMadeDeckId(cards[0].deck_id)
                    show(`Wrote ${cards.length} cards on ${focus}.`, 'success')
                    return true
                  } catch (err) {
                    showError(err)
                    return false
                  }
                },
                onOpen: () => {
                  if (madeDeckId) navigate(`${base}/flashcards?deck=${encodeURIComponent(madeDeckId)}`)
                },
              }
            : undefined
        }
        onRetake={() => retake(quiz)}
        onBack={onBack}
        backLabel={backLabel}
      />
    )
  }

  return (
    <QuizRunner
      key={`${attempt}-${variant ? 'r' : 's'}`}
      quiz={shown}
      draftKey={variant ? variantDraftKey(quiz.id) : quiz.id}
      submit={submitVariant}
      onFinished={(result, answers) => {
        // The wording was for this attempt only.
        if (variant) clearVariant(quiz.id)
        // It has been taken now: the next open is a retake.
        setQuiz((q) => (q ? { ...q, attempts: result.attempts ?? (q.attempts ?? 0) + 1 } : q))
        setFinished({ result, answers })
        onDone()
      }}
      onExit={onBack}
    />
  )
}

/** A whole number of questions from 1 to 20; anything unreadable is the default 5. */
function clampCount(text: string): number {
  const n = Math.floor(Number(text))
  return Number.isFinite(n) && n >= 1 ? Math.min(20, n) : 5
}

function GenerateQuizModal({
  open,
  defaultTopicId,
  quizzes,
  busy,
  onClose,
  onGenerate,
  onRetake,
}: {
  open: boolean
  /** Whose material the quiz draws on, unless another topic is picked. */
  defaultTopicId: string
  /** What already exists, to offer a retake instead of a near-copy. */
  quizzes: Quiz[] | null
  busy: boolean
  onClose: () => void
  onGenerate: (topicId: string, focus: string, count: number, source: PickedSource) => void
  /** Take an existing quiz instead of generating a near-identical one. */
  onRetake: (quizId: string, mode: RetakeMode) => void
}) {
  const [topicId, setTopicId] = useState(defaultTopicId)
  const [topic, setTopic] = useState('')
  // Kept as typed. Clamping on every keystroke snapped an emptied field back to
  // 5, so the only way to enter "10" was to select the 5 first: Backspace did
  // nothing, and typing after it made 51, clamped to 20.
  const [countText, setCountText] = useState('5')
  const count = clampCount(countText)
  const [source, setSource] = useState<PickedSource>(rememberedSource)
  // The existing quiz offered instead, once Generate was pressed; and whether
  // the student said "make a new one anyway" for this focus.
  const [offer, setOffer] = useState<Quiz | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  // Each time it opens it starts from the current topic again.
  useEffect(() => {
    if (open) {
      setTopicId(defaultTopicId)
      setSource(rememberedSource())
      setOffer(null)
      setDismissed(null)
    }
  }, [open, defaultTopicId])

  const submit = () => {
    const focus = topic.trim()
    const similar = findSimilarQuiz(quizzes, topicId, focus)
    if (similar && dismissed !== `${topicId}:${focus.toLowerCase()}`) {
      setOffer(similar)
      return
    }
    onGenerate(topicId, focus, count, source)
  }

  return (
    <Modal open={open} onClose={onClose} title="Make a quiz" width="sm">
      <div className="flex flex-col gap-4">
        <TopicSelect
          value={topicId}
          onChange={(id) => {
            setTopicId(id)
            setOffer(null)
          }}
        />
        {/* `name` is what ties each label to its field (see Input): without it
            the labels were plain text, so tapping one did nothing and a screen
            reader announced two unnamed fields. */}
        <Input
          name="quiz-focus"
          label="What to focus on (optional)"
          className="pointer-coarse:text-base"
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value)
            setOffer(null)
          }}
          maxLength={LIMITS.quizTopic}
          placeholder="Attention basics"
          hint="Leave this empty to cover the whole topic."
        />
        <SourcePicker topicId={topicId} value={source} onChange={setSource} />
        <Input
          name="quiz-count"
          label="How many questions?"
          className="pointer-coarse:text-base"
          type="number"
          min={1}
          max={20}
          inputMode="numeric"
          value={countText}
          onChange={(e) => setCountText(e.target.value)}
          onBlur={() => setCountText(String(count))}
        />
        {offer && (
          <div role="status" className="flex flex-col gap-2.5 rounded-xl border border-brand/30 bg-brand-tint px-3.5 py-3">
            <p className="text-[13px] leading-relaxed text-ink-2">
              You already have <b className="text-ink">{offer.topic}</b> ({offer.questions.length} question
              {offer.questions.length === 1 ? '' : 's'}
              {offer.best_score != null ? `, best ${offer.best_score}%` : ''}). Take that one again instead?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onRetake(offer.id, 'same')} disabled={busy}>
                Take it again
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onRetake(offer.id, 'reworded')} disabled={busy}>
                Take it reworded
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDismissed(`${topicId}:${topic.trim().toLowerCase()}`)
                  setOffer(null)
                  onGenerate(topicId, topic.trim(), count, source)
                }}
              >
                Make a new one anyway
              </Button>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !sourceReady(source) || offer !== null}>
            {busy ? 'Making your quiz…' : 'Make quiz'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
