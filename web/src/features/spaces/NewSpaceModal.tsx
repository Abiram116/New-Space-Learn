import { useState } from 'react'
import type { Tone } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { cn } from '../../lib/cn'
import { toneDot } from '../../lib/tone'
import { useSpaces } from './SpacesProvider'

const tones: Tone[] = ['brand', 'sky', 'mint', 'sun', 'coral']

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
    <Modal open={open} onClose={onClose} title="New space" width="md">
      <div className="flex flex-col gap-4">
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
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Color</span>
          <div className="flex gap-2">
            {tones.map((t) => (
              <button
                key={t}
                type="button"
                aria-label={`Set color ${t}`}
                onClick={() => setTone(t)}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] cursor-pointer',
                  tone === t ? 'border-ink' : 'border-line',
                )}
              >
                <span className={cn('h-4 w-4 rounded-full', toneDot[t])} />
              </button>
            ))}
          </div>
        </div>
        {err && (
          <div className="rounded-lg bg-coral-soft px-3 py-2 text-sm text-coral-deep">{err}</div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Creating…' : 'Create space'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
