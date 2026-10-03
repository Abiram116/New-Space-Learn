/**
 * Settings › Learning: how the AI should teach this student.
 *
 * The same questions as the first run, shown as the same choices — so what was
 * picked there is recognisable here — with room for the student's own words
 * beside them. Below that, what the app has worked out by itself, which stays
 * readable and resettable because anything that changes how you are taught
 * should be something you can see and undo.
 */

import { useState, type ReactNode } from 'react'
import type { Preference } from '../../api/feedback'
import type { StudentModel } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { NumberInput, RowWithText, SavedTick, SavingDot } from '../../components/ui/Row'
import { cn } from '../../lib/cn'
import { LIMITS } from '../../lib/limits'
import { Choice } from '../onboarding/StyleIntakeCard'
import {
  composeStyles,
  DEPTH,
  depthChoice,
  OWN_STYLE_MAX,
  parseStyles,
  SESSION,
  SESSION_MINUTES,
  STYLE,
  TEACHING_PREFERENCE_MAX,
} from './learning'

type Props = {
  student: StudentModel
  savingKey: string | null
  savedKey: string | null
  /** Saves at once. */
  save: (key: string, updates: Partial<StudentModel>) => void
  /** Saves once typing pauses. */
  saveText: (key: string, updates: Partial<StudentModel>) => void
  learned: Preference[]
  resetting: boolean
  onResetLearned: () => void
}

const field =
  'w-full rounded-[10px] border border-line bg-well px-3 py-2.5 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'
const link = 'cursor-pointer self-start text-[13px] text-brand-deep hover:underline'

export function LearningPanel({ student, savingKey, savedKey, save, saveText, learned, resetting, onResetLearned }: Props) {
  const styles = parseStyles(student.learning_style)
  // Their own words are held here while they type: reading them back out of
  // the joined string on every keystroke would eat a trailing space.
  const [own, setOwn] = useState(styles.own)
  const [ownOpen, setOwnOpen] = useState(styles.own !== '')

  const depth = depthChoice(student.teaching_preference)
  const [writing, setWriting] = useState(Boolean(student.teaching_preference?.trim()) && depth === null)

  const minutes = student.session_length_minutes ?? 20
  const inferred = learned.filter((p) => p.source !== 'explicit')
  const tell = (key: string) => (savingKey === key ? <SavingDot /> : savedKey === key ? <SavedTick /> : null)

  return (
    <>
      <p className="text-[13.5px] text-muted">How the AI explains things to you. It saves as you go.</p>

      <div className="flex flex-col gap-4">
      <Card title={STYLE.ask} hint={STYLE.aside} tell={tell('learning_style')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {STYLE.options.map((o) => {
            const on = styles.picked.includes(o.value)
            return (
              <Choice
                key={o.value}
                on={on}
                role="checkbox"
                label={o.label}
                hint={o.hint}
                onClick={() =>
                  save('learning_style', {
                    learning_style: composeStyles(on ? styles.picked.filter((v) => v !== o.value) : [...styles.picked, o.value], own),
                  })
                }
              />
            )
          })}
        </div>
        {ownOpen ? (
          <input
            value={own}
            maxLength={OWN_STYLE_MAX}
            onChange={(e) => {
              setOwn(e.target.value)
              saveText('learning_style', { learning_style: composeStyles(styles.picked, e.target.value) })
            }}
            placeholder="e.g. diagrams, real-world uses, one step at a time"
            aria-label="Anything else that helps, in your own words"
            className={field}
          />
        ) : (
          <button type="button" onClick={() => setOwnOpen(true)} className={link}>
            + Add something in your own words
          </button>
        )}
      </Card>

      <Card title={DEPTH.ask} hint={DEPTH.aside} tell={tell('teaching_preference')}>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={DEPTH.ask}>
          {DEPTH.options.map((o) => (
            <Choice
              key={o.value}
              on={!writing && depth === o.value}
              role="radio"
              label={o.label}
              hint={o.hint}
              onClick={() => {
                setWriting(false)
                save('teaching_preference', { teaching_preference: depth === o.value && !writing ? null : o.value })
              }}
            />
          ))}
        </div>
        {writing ? (
          <textarea
            value={student.teaching_preference ?? ''}
            maxLength={TEACHING_PREFERENCE_MAX}
            rows={3}
            onChange={(e) => saveText('teaching_preference', { teaching_preference: e.target.value || null })}
            placeholder="e.g. Explain it like I’m new to this, then show me the exam version."
            aria-label="How to explain things, in your own words"
            className={cn(field, 'resize-none')}
          />
        ) : (
          <button type="button" onClick={() => setWriting(true)} className={link}>
            + Write it in your own words instead
          </button>
        )}
      </Card>

      <Card title={SESSION.ask} hint={SESSION.aside} tell={tell('session_length_minutes')}>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={SESSION.ask}>
          {SESSION.options.map((o) => {
            const on = minutes === Number(o.value)
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => save('session_length_minutes', { session_length_minutes: Number(o.value) })}
                className={cn(
                  'min-h-10 cursor-pointer rounded-full border px-4 text-[13.5px] transition-colors max-md:min-h-11',
                  on ? 'border-brand/60 bg-brand-soft font-semibold text-brand-deep' : 'border-line bg-raised text-ink-2 hover:border-line-dash',
                )}
              >
                {o.label}
              </button>
            )
          })}
          <label className="ml-auto flex items-center gap-2 text-[13px] text-muted">
            <span className={cn(SESSION_MINUTES.includes(minutes) && 'max-sm:sr-only')}>or exactly</span>
            <NumberInput
              value={minutes}
              min={5}
              max={180}
              label="Session length in minutes"
              onCommit={(n) => save('session_length_minutes', { session_length_minutes: n })}
            />
            min
          </label>
        </div>
      </Card>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <RowWithText
          label="Working towards"
          hint="An exam, a course or a job. Answers lean towards it."
          placeholder="e.g. GATE 2027"
          maxLength={LIMITS.examContext}
          value={student.exam_context}
          onChange={(v) => saveText('exam_context', { exam_context: v })}
          saving={savingKey === 'exam_context'}
          saved={savedKey === 'exam_context'}
          last
        />
      </div>

      {/* Only what the app worked out by itself. What the student chose is
          already on this page as the choice they made; listing it again here
          as "learned" said nothing and buried the part that is new. */}
      {inferred.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 text-[14px]">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-ink">Picked up from your 👍 and 👎</div>
              <p className="mt-0.5 text-[12.5px] text-faint">
                What I’ve adjusted from how you rated answers. Reset to start over.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={onResetLearned} disabled={resetting} className="min-w-24 shrink-0">
              Reset
            </Button>
          </div>
          <ul className="mt-3 flex flex-col divide-y divide-line-soft">
            {inferred.map((p) => (
              <li key={p.key} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn('min-w-0', p.actionable ? 'text-ink' : 'text-muted')}>
                    {PREF_LABEL[p.key] ?? p.key}: <b>{PREF_VALUE[p.value] ?? p.value}</b>
                  </span>
                  <span className="shrink-0 text-[12.5px] text-muted">{confidenceWord(p)}</span>
                </div>
                {p.because && <span className="text-[12.5px] text-faint">{p.because}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Read-only on purpose: these are things the app noticed, not things
          the student said, and putting them in an editable box would show
          someone a sentence they never wrote as if they had. */}
      {student.observed_habits.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4 text-[14px]">
          <div className="mb-2 font-semibold text-ink">What I’ve noticed</div>
          <ul className="flex flex-col gap-1.5 text-ink-2">
            {student.observed_habits.map((h) => (
              <li key={h} className="leading-snug">
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      </div>
    </>
  )
}

function Card({ title, hint, tell, children }: { title: string; hint: string; tell: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-[14.5px] font-semibold text-ink">{title}</h3>
          {tell}
        </div>
        <p className="mt-0.5 text-[12.5px] text-faint">{hint}</p>
      </div>
      {children}
    </section>
  )
}

/** Preference keys read as sentences, not dotted paths. */
const PREF_LABEL: Record<string, string> = {
  'explanation.length': 'Explanation length',
  'explanation.depth': 'Level',
  'explanation.opens_with': 'Starts with',
  'explanation.note': 'In your words',
  'interaction.mode': 'How you study',
  'interaction.answer_mode': 'Answers',
  'session.length_minutes': 'Session length',
  'study.goal': 'Studying for',
}

const PREF_VALUE: Record<string, string> = {
  concise: 'short and direct',
  detailed: 'thorough',
  simpler: 'plainer language',
  deeper: 'more advanced',
  example_first: 'an example',
  theory_first: 'the principle',
  direct: 'straight to the point',
  hints_first: 'hints before answers',
  discussion: 'by asking questions',
  drilling: 'by drilling cards',
  testing: 'by testing yourself',
}

/**
 * Confidence as a word.
 *
 * A percentage implies a measurement this isn't — 0.62 looks like it was
 * measured to two digits when it is the output of a hand-tuned update rule.
 * A word is honest about the precision and is what the student actually needs
 * to decide whether to correct it.
 */
function confidenceWord(p: Preference): string {
  if (!p.actionable) return 'still guessing'
  if (p.confidence >= 0.75) return 'confident'
  if (p.confidence >= 0.5) return 'fairly sure'
  return 'leaning that way'
}
