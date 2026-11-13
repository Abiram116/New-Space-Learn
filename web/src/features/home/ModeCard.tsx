/**
 * Asked once, on Home, until answered: "What are you working towards?"
 *
 * It is the single answer that changes the most about what this app does for
 * someone (how the tutor talks, how questions are written, what Home plans), so
 * a student who skipped it at sign-up gets it where they land. Picking one
 * saves it and the card goes; "Not now" hides it on this device.
 */

import { useState } from 'react'
import { updateStudentModel } from '../../api/me'
import type { StudentModel } from '../../api/types'
import { Icon } from '../../components/ui/Icon'
import { friendlyMessage } from '../../api/errors'
import { writeCache } from '../../lib/asyncCache'
import { guessMode, STUDY_MODES, type StudyMode } from '../../lib/studyMode'
import { STUDENT_MODEL_KEY } from '../onboarding/skippedStyle'

const DISMISSED = 'sl:mode-card-dismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1'
  } catch {
    return false
  }
}

export function ModeCard({ model }: { model: StudentModel | null | undefined }) {
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(wasDismissed)
  const [saving, setSaving] = useState<StudyMode | null>(null)

  if (!model || model.study_mode || hidden) return null
  const goal = model.exam_context?.trim()
  const guess = guessMode(goal)

  const pick = async (mode: StudyMode) => {
    setSaving(mode)
    setError(null)
    try {
      writeCache(STUDENT_MODEL_KEY, await updateStudentModel({ study_mode: mode }))
    } catch (err) {
      setError(friendlyMessage(err))
      setSaving(null)
    }
  }
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, '1')
    } catch {
      /* the card just comes back next visit */
    }
    setHidden(true)
  }

  return (
    <section aria-label="What are you working towards?" className="cardstock flex flex-col gap-3 rounded-xl border border-line p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="nameplate text-[18px] text-ink">
            {goal ? `What kind of prep is “${goal}”?` : 'What are you working towards?'}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            Answers, questions and your plan are written for it. You can change it any time, even mid-chat.
          </p>
        </div>
        <button type="button" onClick={dismiss} className="setcode shrink-0 cursor-pointer hover:text-ink">
          Not now
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {STUDY_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            disabled={saving !== null}
            onClick={() => void pick(m.value)}
            className={`flex min-h-14 cursor-pointer items-start gap-2.5 rounded-[12px] border bg-raised p-3 text-left transition-colors hover:border-brand/40 disabled:opacity-60 ${guess === m.value ? 'border-brand/50' : 'border-line'}`}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-well text-ink-3" aria-hidden>
              <Icon name={m.icon} size={15} />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold leading-tight text-ink">
                {m.label}
                {guess === m.value && <span className="setcode ml-1.5 text-brand-deep">looks right</span>}
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">{m.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-[12.5px] text-muted">
          {error}
        </p>
      )}
    </section>
  )
}
