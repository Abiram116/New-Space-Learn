/**
 * Settings › Learning: how the AI should teach this student.
 *
 * The same questions as the first run, shown as the same choices — so what was
 * picked there is recognisable here — with room for the student's own words
 * beside them. Below that, what the app has worked out by itself, which stays
 * readable and resettable because anything that changes how you are taught
 * should be something you can see and undo.
 */

import { useState } from 'react'
import type { IconName } from '../../components/ui/Icon'
import { Rise } from '../../components/ui/motion'
import type { Preference } from '../../api/feedback'
import type { StudentModel } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'
import { LIMITS } from '../../lib/limits'
import {
  composeStyles,
  DEPTH,
  depthChoice,
  OWN_STYLE_MAX,
  parseStyles,
  SESSION,
  STYLE,
  TEACHING_PREFERENCE_MAX,
} from './learning'
import { OptionCard, Pill, SaveTell, Segmented, SessionDial, SettingsCard, Stepper } from './parts'

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
  'w-full rounded-[12px] border border-line bg-well px-3 py-2.5 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'
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
  const depthIndex = DEPTH.options.findIndex((o) => o.value === depth)
  const inferred = learned.filter((p) => p.source !== 'explicit')
  const tell = (key: string) => <SaveTell saving={savingKey === key} saved={savedKey === key} />

  return (
    <>
      <Rise className="col-span-full"><SettingsCard tone="hero" icon="sparkle" title={STYLE.ask} hint={STYLE.aside} tell={tell('learning_style')}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
          {STYLE.options.map((o, i) => {
            const on = styles.picked.includes(o.value)
            return (
              <OptionCard
                key={o.value}
                on={on}
                icon={STYLE_ICON[i] ?? 'sparkle'}
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
      </SettingsCard></Rise>

      <Rise delay={50} className="h-full">
        <SettingsCard icon="listOrdered" title={DEPTH.ask} hint={DEPTH.aside} tell={tell('teaching_preference')}>
          <Segmented
            label={DEPTH.ask}
            options={DEPTH.options.map((o) => ({ value: o.value, label: o.label }))}
            value={writing ? -1 : DEPTH.options.findIndex((o) => o.value === depth)}
            onPick={(v) => {
              setWriting(false)
              save('teaching_preference', { teaching_preference: depth === v && !writing ? null : v })
            }}
          />
          {!writing && depthIndex >= 0 && (
            <div key={depthIndex} className="mt-3 rounded-xl bg-well px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider text-faint">{DEPTH.options[depthIndex].hint}</div>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{DEPTH_SAMPLE[depthIndex]}</p>
            </div>
          )}
          <div className="mt-3">
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
          </div>
        </SettingsCard>
      </Rise>

      <Rise delay={100} className="h-full">
        <SettingsCard icon="clock" title={SESSION.ask} hint={SESSION.aside} tell={tell('session_length_minutes')}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <SessionDial minutes={minutes} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={SESSION.ask}>
                {SESSION.options.map((o) => (
                  <Pill
                    key={o.value}
                    on={minutes === Number(o.value)}
                    onClick={() => save('session_length_minutes', { session_length_minutes: Number(o.value) })}
                  >
                    {o.label}
                  </Pill>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                <span>or exactly</span>
                <Stepper
                  value={minutes}
                  min={5}
                  max={180}
                  step={5}
                  unit="min"
                  label="Session length in minutes"
                  onCommit={(n) => save('session_length_minutes', { session_length_minutes: n })}
                />
              </div>
            </div>
          </div>
        </SettingsCard>
      </Rise>

      <Rise delay={150} className="h-full">
        <SettingsCard icon="target" title="Working towards" hint="An exam, a course or a job. Answers lean towards it." tell={tell('exam_context')}>
          <input
            type="text"
            value={student.exam_context ?? ''}
            maxLength={LIMITS.examContext}
            aria-label="Working towards"
            placeholder="e.g. GATE 2027"
            onChange={(e) => saveText('exam_context', { exam_context: e.target.value || null })}
            className={field}
          />
        </SettingsCard>
      </Rise>

      {/* Only what the app worked out by itself. What the student chose is
          already on this page as the choice they made; listing it again here
          as "learned" said nothing and buried the part that is new. */}
      {inferred.length > 0 && (
        <div className="col-span-full rounded-2xl border border-line bg-surface p-4 text-[14px]">
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
        <div className="col-span-full rounded-2xl border border-line bg-surface p-5 text-[14px]">
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

    </>
  )
}

/** One icon per first-run style choice, in the choices' own order. */
const STYLE_ICON: IconName[] = ['listTodo', 'sparkle', 'quote', 'table']

/** What each depth sounds like — one neutral illustration, not the student's data. */
const DEPTH_SAMPLE = [
  'Entropy measures disorder: how many ways a system can be arranged.',
  'Entropy counts the arrangements a system can take. Start with two gases in a box, see why mixing wins by sheer numbers, then connect it to temperature and heat.',
  'A quick question gets a line. A hard one gets the whole walk-through, step by step.',
]

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
