/**
 * "Study this note": a quiz or a deck written from one note, from the Notes
 * page. One small button and a two-choice dialog; the work is the same
 * `generateQuiz` / `generateCards` call the Quizzes and Cards pages make, with
 * the note as the source.
 *
 * The server reads the note's last SAVED version. The editor saves a moment
 * after typing stops, so the dialog says so rather than pretending otherwise.
 */

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateCards } from '../../api/flashcards'
import { generateQuiz } from '../../api/quizzes'
import type { Note } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { LIMITS } from '../../lib/limits'

/** Shorter than this, once markup is gone, and there is nothing to ask about
 *  (`NOTE_MIN_CHARS` on the server). */
const MIN_CHARS = 40

/** What the server will see of a note, roughly: no images, no tags. */
export function noteHasMaterial(body: string): boolean {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
  return text.length >= MIN_CHARS
}

export function MakeFromNote({
  note,
  topicId,
  base,
}: {
  note: Note
  /** The note's own topic: the quiz or deck is made there. */
  topicId: string
  /** Route prefix for that topic. */
  base: string
}) {
  const navigate = useNavigate()
  const { show, showError } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'quiz' | 'cards' | null>(null)
  const inFlight = useRef(false)
  const ready = noteHasMaterial(note.body_md)

  const make = async (what: 'quiz' | 'cards') => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(what)
    try {
      if (what === 'quiz') {
        const quiz = await generateQuiz(topicId, { count: 5, source: 'notes', note_id: note.id })
        setOpen(false)
        navigate(`${base}/quizzes?q=${encodeURIComponent(quiz.id)}`)
      } else {
        const cards = await generateCards(topicId, {
          count: 8,
          source: 'notes',
          note_id: note.id,
          deck_name: (note.title || 'Note').slice(0, LIMITS.deckName),
        })
        setOpen(false)
        show(`Wrote ${cards.length} cards from this note.`, 'success')
        if (cards[0]) navigate(`${base}/flashcards?deck=${encodeURIComponent(cards[0].deck_id)}`)
      }
    } catch (err) {
      showError(err)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={!ready}
        title={ready ? 'Make a quiz or cards from this note' : 'Write a little more in this note first'}
      >
        <Icon name="quiz" size={14} /> Study this note
      </Button>
      <Modal open={open} onClose={busy ? () => {} : () => setOpen(false)} title="Study this note" width="sm">
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed text-muted">
            Written only from “{note.title || 'Untitled note'}”, as last saved.
          </p>
          <Button onClick={() => void make('quiz')} disabled={busy !== null}>
            <Icon name="quiz" size={14} /> {busy === 'quiz' ? 'Writing the quiz…' : 'Quiz me on it (5 questions)'}
          </Button>
          <Button variant="secondary" onClick={() => void make('cards')} disabled={busy !== null}>
            <Icon name="deck" size={14} /> {busy === 'cards' ? 'Writing cards…' : 'Make cards (8)'}
          </Button>
        </div>
      </Modal>
    </>
  )
}
