/**
 * Change what you're working towards — mode, goal and date, in one place.
 *
 * People's situations move: the semester ends and an interview starts; a GATE
 * year turns into a placement season. Changing focus should be one dialog, not
 * three settings, and it should say what it changes. Saving updates the same
 * student model the tutor, quizzes and Home already read, so the very next
 * answer and the plan on Home follow.
 */

import { useState } from 'react'
import { friendlyMessage } from '../../api/errors'
import { updateStudentModel } from '../../api/me'
import type { StudentModel } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Modal, ModalFooter } from '../../components/ui/Modal'
import { writeCache } from '../../lib/asyncCache'
import { cn } from '../../lib/cn'
import { LIMITS } from '../../lib/limits'
import { guessMode, modeInfo, STUDY_MODES, type StudyMode } from '../../lib/studyMode'
import { STUDENT_MODEL_KEY } from '../onboarding/skippedStyle'
import { daysUntil } from './exam'

/** Local calendar date, `n` days out, as YYYY-MM-DD (what the server stores). */
function inDays(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const QUICK = [
  { label: 'In a week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
  { label: 'In a month', days: 30 },
]

const field =
  'w-full rounded-[12px] border border-line bg-well px-3 py-2.5 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

export function FocusDialog({ model, open, onClose }: { model: StudentModel; open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<StudyMode | null>(model.study_mode ?? guessMode(model.exam_context))
  const [goal, setGoal] = useState(model.exam_context ?? '')
  const [date, setDate] = useState(model.exam_date ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const info = modeInfo(mode)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateStudentModel({
        study_mode: mode,
        exam_context: goal.trim() || null,
        exam_date: date || null,
      })
      writeCache(STUDENT_MODEL_KEY, updated)
      onClose()
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="What are you working towards?"
      footer={
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            Save
          </Button>
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13.5px] leading-snug text-muted">
          From your next message, answers, questions and your plan follow this. Nothing you have already made changes.
        </p>
        <div role="radiogroup" aria-label="Kind of prep" className="grid gap-2 sm:grid-cols-2">
          {STUDY_MODES.map((m) => {
            const on = mode === m.value
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMode(m.value)}
                className={cn(
                  'cursor-pointer rounded-[12px] border p-3 text-left transition-colors',
                  on ? 'border-brand/60 bg-brand-soft' : 'border-line bg-raised hover:border-line-dash',
                )}
              >
                <span className={cn('block text-[14px] font-semibold', on ? 'text-brand-deep' : 'text-ink')}>{m.label}</span>
                <span className="mt-0.5 block text-[12px] text-muted">{m.hint}</span>
              </button>
            )
          })}
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
          Goal, in your words
          <input
            value={goal}
            maxLength={LIMITS.examContext}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={info?.goal ?? 'e.g. GATE CSE 2027'}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
          <span>
            {info?.event === 'interview' ? 'Interview date' : 'Exam date'} <span className="font-normal text-faint">(optional, Home counts down)</span>
          </span>
          <input
            type="date"
            value={date}
            min={inDays(0)}
            onChange={(e) => setDate(e.target.value)}
            className={cn(field, '[color-scheme:dark]')}
          />
        </label>
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          {QUICK.map((q) => (
            <button
              key={q.days}
              type="button"
              onClick={() => setDate(inDays(q.days))}
              className={cn(
                'min-h-8 cursor-pointer rounded-full border px-3 text-[12.5px] font-semibold transition-colors',
                date === inDays(q.days) ? 'border-brand/60 bg-brand-soft text-brand-deep' : 'border-line text-ink-3 hover:border-line-dash hover:text-ink',
              )}
            >
              {q.label}
            </button>
          ))}
          {date && (
            <>
              <span className="text-[12.5px] text-muted">
                {(() => {
                  const n = daysUntil(date)
                  return n === null ? '' : n < 0 ? 'That date has passed' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`
                })()}
              </span>
              <button type="button" onClick={() => setDate('')} className="cursor-pointer text-[12.5px] font-semibold text-muted hover:text-ink">
                Clear
              </button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] text-muted">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
