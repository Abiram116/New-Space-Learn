/**
 * The two dialogs that create decks — by hand, and from a topic's material.
 */

import { useEffect, useState } from 'react'
import { LIMITS } from '../../lib/limits'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { TopicSelect, useTopicName } from '../spaces/TopicSelect'

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
    if (!name.trim()) return
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
  onGenerate: (topicId: string, focus: string | undefined, count: number) => Promise<void>
}) {
  const [topicId, setTopicId] = useState(defaultTopicId)
  const topicName = useTopicName(topicId)
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(8)
  const [busy, setBusy] = useState(false)
  const { showError } = useToast()

  useEffect(() => {
    if (open) {
      setTopic('')
      setCount(8)
      setTopicId(defaultTopicId)
    }
  }, [open, defaultTopicId])

  const submit = async () => {
    setBusy(true)
    try {
      await onGenerate(topicId, topic.trim() || undefined, count)
    } catch (err) {
      showError(err)
    } finally {
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
          hint="Left blank, it draws on everything indexed in the topic above."
        />
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
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Writing cards…' : 'Generate'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
