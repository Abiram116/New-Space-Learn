/**
 * "How do you want this note?" — asked before the notes agent runs.
 *
 * The backend has accepted and honoured a free-text `instructions` field since
 * the agent was written, and honours it properly: it is placed last in the
 * prompt and marked as overriding the default shape guidance, so "just a
 * checklist" really does return a checklist. Nothing in the UI ever collected
 * it, so the whole capability was invisible — the student got one house style
 * whether it suited the material or not.
 *
 * Two deliberate choices about the shape of this:
 *
 * **The examples are prefills, not options.** Tapping one writes its text into
 * the field, which stays editable. A fixed set of style buttons was the obvious
 * alternative and is the one `NoteGenerate.instructions` explicitly rejects: an
 * enum can only offer the shapes someone thought of in advance, and the model
 * handles the long tail of phrasings fine. Prefills teach the field's range
 * without closing it.
 *
 * **Both fields are optional.** Enter on an untouched dialog produces exactly
 * what the agent produced before this screen existed, so the fast path costs
 * one keystroke and nobody has to fill in a form to get a note.
 */

import { useEffect, useState } from 'react'
import { LIMITS } from '../../lib/limits'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'

/** Prefills, in the student's own register rather than a taxonomy of styles. */
const EXAMPLES = [
  'Just a checklist I can tick off',
  'Go deep — I have an exam on this',
  'Bullet points only, no prose',
  'Explain it like I have not seen it before',
]

export function NoteBriefDialog({
  open,
  topic,
  busy,
  onCancel,
  onGenerate,
}: {
  open: boolean
  /** Whatever followed `/notes` in the composer, if anything. */
  topic?: string
  busy: boolean
  onCancel: () => void
  onGenerate: (input: { topic?: string; instructions?: string }) => void
}) {
  const [topicText, setTopicText] = useState(topic ?? '')
  const [instructions, setInstructions] = useState('')

  // Reset per opening. Without this the dialog reopens holding the previous
  // note's brief, so the second note silently inherits the first one's
  // instructions — the kind of stale-state bug that looks like the model
  // ignoring you.
  useEffect(() => {
    if (open) {
      setTopicText(topic ?? '')
      setInstructions('')
    }
  }, [open, topic])

  const submit = () => {
    if (busy) return
    onGenerate({
      topic: topicText.trim() || undefined,
      instructions: instructions.trim() || undefined,
    })
  }

  return (
    <Modal open={open} onClose={onCancel} title="Write a note" width="lg">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="setcode">What about?</span>
          <input
            autoFocus
            value={topicText}
            onChange={(e) => setTopicText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            maxLength={LIMITS.noteTopic}
            placeholder="Leave blank to cover the key concepts so far"
            className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-[13.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="setcode">How do you want it?</span>
          <textarea
            rows={3}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline. Same contract as the
              // composer this dialog is launched from, so the muscle memory
              // carries over.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            maxLength={LIMITS.noteInstructions}
            placeholder="In your own words — anything here beats the default shape"
            className="w-full resize-none rounded-[10px] border border-line bg-canvas px-3 py-2 text-[13.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
          />
        </label>

        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setInstructions(ex)}
              className="rounded-full bg-line-soft px-2.5 py-1 text-[11.5px] text-ink-3 transition-colors cursor-pointer hover:bg-brand-soft hover:text-brand-deep"
            >
              {ex}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            <Icon name="sparkle" size={13} /> {busy ? 'Writing…' : 'Write it'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
