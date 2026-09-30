import { useState } from 'react'
import type { Tone } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal, ModalFooter } from '../../components/ui/Modal'
import { cn } from '../../lib/cn'
import { toneDot } from '../../lib/tone'
import { useSpaces } from './SpacesProvider'

const tones: Tone[] = ['brand', 'sky', 'mint', 'sun', 'coral', 'azure', 'jade']

export function NewSpaceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated?: (id: string) => void
}) {
  const { createSpace, addSubspace } = useSpaces()
  const [name, setName] = useState('')
  const [firstTopic, setFirstTopic] = useState('')
  const [tone, setTone] = useState<Tone>('brand')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    if (name.trim().length < 1) {
      setErr('Give this subject a short name.')
      return
    }
    setBusy(true)
    try {
      const space = await createSpace({ name: name.trim(), tone })
      if (firstTopic.trim()) {
        await addSubspace(space.id, firstTopic.trim())
      }
      onCreated?.(space.id)
      setName('')
      setFirstTopic('')
      setTone('brand')
      onClose()
    } catch (e) {
      setErr(friendlyMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New subject"
      width="md"
      footer={
        <ModalFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
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
        <Input
          label="Subject"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Deep Learning"
          autoFocus
        />
        <Input
          label="First topic (optional)"
          value={firstTopic}
          onChange={(e) => setFirstTopic(e.target.value)}
          placeholder="Transformers"
          hint="You can add more topics later."
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
        {err && (
          <div role="alert" className="rounded-lg bg-coral-soft px-3 py-2.5 text-[14px] text-coral-deep">
            {err}
          </div>
        )}
      </form>
    </Modal>
  )
}
