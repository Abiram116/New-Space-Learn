import { useRef, useState } from 'react'
import type { Space, Subspace, Tone } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal, ModalFooter } from '../../components/ui/Modal'
import { cn } from '../../lib/cn'
import { LIMITS } from '../../lib/limits'
import { nameHint } from '../../lib/nameHint'
import { toneDot } from '../../lib/tone'
import { useSpaces } from './SpacesProvider'
import { SubjectIcon } from './SubjectIcon'

const tones: Tone[] = ['brand', 'sky', 'mint', 'sun', 'coral', 'azure', 'jade']

export function NewSpaceModal({
  open,
  onClose,
  onCreated,
  onTopicCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated?: (id: string) => void
  /** The new subject and its first topic, for a caller that opens the topic. */
  onTopicCreated?: (made: { space: Space; subspace: Subspace }) => void
}) {
  const { createSpace, addSubspace } = useSpaces()
  const [name, setName] = useState('')
  const [firstTopic, setFirstTopic] = useState('')
  const [tone, setTone] = useState<Tone>('brand')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // The subject and its first topic are two requests. When the second one
  // failed, the dialog stayed open with the error — and pressing Create again
  // made the subject a second time. The subject that already exists is kept
  // here so a retry only repeats the step that failed.
  const made = useRef<{ name: string; tone: Tone; space: Space } | null>(null)
  const submitting = useRef(false)

  const submit = async () => {
    if (submitting.current) return
    setErr(null)
    const subject = name.trim()
    if (subject.length < 1) {
      setErr('Give your subject a short name.')
      return
    }
    submitting.current = true
    setBusy(true)
    try {
      const prior = made.current
      const space =
        prior && prior.name === subject && prior.tone === tone
          ? prior.space
          : await createSpace({ name: subject, tone })
      made.current = { name: subject, tone, space }
      // Material lives in a topic, so there is always one: left empty, it
      // takes the subject's name, as on the phone.
      const topic = firstTopic.trim() || subject.slice(0, LIMITS.subspaceName)
      const subspace = await addSubspace(space.id, topic)
      made.current = null
      onCreated?.(space.id)
      onTopicCreated?.({ space, subspace })
      setName('')
      setFirstTopic('')
      setTone('brand')
      onClose()
    } catch (e) {
      setErr(friendlyMessage(e))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  // Closing forgets a half-made subject: it is already in the rail, and the
  // next time this opens it is for a new one.
  const close = () => {
    made.current = null
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="New subject"
      width="md"
      footer={
        <ModalFooter>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          {/* Same label while busy — the spinner-less "Creating…" swap made the
              button change width under the cursor. `aria-busy` carries the
              state instead. */}
          <Button type="submit" form="new-space-form" disabled={busy} aria-busy={busy} className="min-w-36">
            {busy ? 'Creating…' : 'Create subject'}
          </Button>
        </ModalFooter>
      }
    >
      <form
        id="new-space-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <p className="text-[14px] leading-relaxed text-muted">
          A subject is a course, like Biology. Topics are its parts, like Cells: each keeps its own documents, chat and
          cards.
        </p>
        {/* `Input` ties its label to the field by id; without one the label
            was loose text, so a screen reader announced two unnamed boxes. */}
        <Input
          id="new-subject-name"
          label="Subject"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Deep Learning"
          maxLength={LIMITS.spaceName}
          hint={nameHint(name) ?? undefined}
          autoFocus
        />
        <Input
          id="new-subject-first-topic"
          label="First topic (optional)"
          value={firstTopic}
          onChange={(e) => setFirstTopic(e.target.value)}
          placeholder="Transformers"
          maxLength={LIMITS.subspaceName}
          hint={nameHint(firstTopic) ?? "Leave it empty to name it after the subject. You can add more topics later."}
        />
        <div className="flex flex-col gap-1.5" role="group" aria-label="Color">
          <span className="setcode">Color</span>
          <div className="flex flex-wrap gap-2">
            {tones.map((t) => (
              <button
                key={t}
                type="button"
                aria-label={`Set color ${t}`}
                aria-pressed={tone === t}
                onClick={() => setTone(t)}
                className={cn(
                  'flex h-10 w-10 max-md:h-11 max-md:w-11 cursor-pointer items-center justify-center rounded-full border-[1.5px] transition-colors',
                  tone === t ? 'border-ink' : 'border-line hover:border-line-dash',
                )}
              >
                <span className={cn('h-5 w-5 rounded-full', toneDot[t])} />
              </button>
            ))}
          </div>
        </div>
        {/* What it will look like in the rail: the icon comes from the name
            (there is no icon to pick — see lib/subjectIcon), the tile from
            the colour above. Updates as you type. */}
        <div className="flex items-center gap-3 rounded-xl border border-line bg-well/50 px-3 py-2.5">
          <SubjectIcon space={{ name: name.trim(), tone }} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-ink">{name.trim() || 'Your subject'}</p>
            <p className="text-[12.5px] text-muted">The icon follows the name.</p>
          </div>
        </div>
        {err && (
          <div role="alert" className="rounded-lg bg-coral-soft px-3 py-2.5 text-[14px] text-coral-deep">
            {err}
          </div>
        )}
      </form>
    </Modal>
  )
}
