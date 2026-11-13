/**
 * The two dialogs that create decks — by hand, and from a topic's material —
 * and the one that renames a deck (quizzes use it for their name too).
 */

import { useEffect, useRef, useState } from 'react'
import { LIMITS } from '../../lib/limits'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { TopicSelect, useTopicName } from '../spaces/TopicSelect'
import {
  rememberSource,
  rememberedSource,
  SourcePicker,
  sourceReady,
  type PickedSource,
} from '../quizzes/SourcePicker'

export function NewDeckModal({
  open,
  defaultTopicId,
  onClose,
  onCreate,
}: {
  open: boolean
  /** Where the deck goes unless the student picks another topic. */
  defaultTopicId: string
  onClose: () => void
  onCreate: (name: string, topicId: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [topicId, setTopicId] = useState(defaultTopicId)
  const [busy, setBusy] = useState(false)
  const { showError } = useToast()

  useEffect(() => {
    if (open) {
      setName('')
      setTopicId(defaultTopicId)
    }
  }, [open, defaultTopicId])

  const submit = async () => {
    // `busy` too: Enter in the field calls this directly, so a second Enter
    // while the first request was out created the deck twice.
    if (busy || !name.trim()) return
    setBusy(true)
    try {
      await onCreate(name.trim(), topicId)
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New deck">
      <div className="flex flex-col gap-3">
        <Input
          name="deck"
          label="Deck name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="pointer-coarse:text-base"
          maxLength={LIMITS.deckName}
          placeholder="Photosynthesis"
          autoFocus
        />
        <TopicSelect value={topicId} onChange={setTopicId} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create deck'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function GenerateModal({
  open,
  defaultTopicId,
  onClose,
  onGenerate,
}: {
  open: boolean
  /** Whose material the cards are drawn from, unless another topic is picked. */
  defaultTopicId: string
  onClose: () => void
  onGenerate: (topicId: string, focus: string | undefined, count: number, source: PickedSource) => Promise<void>
}) {
  const [topicId, setTopicId] = useState(defaultTopicId)
  const topicName = useTopicName(topicId)
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(8)
  const [source, setSource] = useState<PickedSource>(rememberedSource)
  const [busy, setBusy] = useState(false)
  // A second click before `busy` re-renders would write (and pay for) a second deck.
  const inFlight = useRef(false)
  const { showError } = useToast()

  useEffect(() => {
    if (open) {
      setTopic('')
      setCount(8)
      setTopicId(defaultTopicId)
      setSource(rememberedSource())
    }
  }, [open, defaultTopicId])

  const submit = async () => {
    if (inFlight.current || !sourceReady(source)) return
    inFlight.current = true
    setBusy(true)
    try {
      await onGenerate(topicId, topic.trim() || undefined, count, source)
      rememberSource(source)
    } catch (err) {
      showError(err)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Generate a deck">
      <div className="flex flex-col gap-3">
        <TopicSelect value={topicId} onChange={setTopicId} />
        <Input
          name="topic"
          label="Focus (optional)"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="pointer-coarse:text-base"
          maxLength={LIMITS.cardsTopic}
          placeholder={topicName}
          hint="Left blank, it covers everything in what you pick below."
        />
        <SourcePicker topicId={topicId} value={source} onChange={setSource} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="count" className="setcode">
            How many cards
          </label>
          <div className="flex items-center gap-3">
            <input
              id="count"
              type="range"
              min={3}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="flex-1 accent-[var(--color-brand)]"
            />
            <span className="nameplate w-8 text-right text-[22px] tabular-nums text-brand">
              {count}
            </span>
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-faint">
          Drafted cards are a starting point — edit anything that reads wrong before
          you rely on it.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !sourceReady(source)}>
            {busy ? 'Writing cards…' : 'Generate'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * One field, the current name in it. Stays open on a failed save, with the
 * typed name intact, so nothing has to be typed twice.
 */
export function RenameModal({
  open,
  title,
  label,
  current,
  maxLength,
  onClose,
  onSave,
}: {
  open: boolean
  /** "Rename deck" / "Rename quiz". */
  title: string
  /** The field's label: "Deck name" / "Quiz name". */
  label: string
  current: string
  maxLength: number
  onClose: () => void
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)
  const { showError } = useToast()

  useEffect(() => {
    if (open) setName(current)
  }, [open, current])

  const clean = name.trim()
  const submit = async () => {
    if (busy || !clean) return
    // Unchanged: nothing to send.
    if (clean === current.trim()) {
      onClose()
      return
    }
    setBusy(true)
    try {
      await onSave(clean)
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} width="sm">
      <div className="flex flex-col gap-3">
        <Input
          name="rename"
          label={label}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="pointer-coarse:text-base"
          maxLength={maxLength}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !clean}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
