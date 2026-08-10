/**
 * Whether the student is currently being assessed.
 *
 * A quiz is only worth anything if the answers came from the student. With the
 * tutor one panel away, "what's the answer to this" is a two-second detour that
 * makes every score in the app a lie — and the student model, the brief and the
 * spaced-repetition schedule are all built on those scores being real. So while
 * a quiz or a card review is in progress the chat composer locks.
 *
 * Deliberately **not** framed as an accusation. The lock says what it is doing
 * and why ("answers should be yours"), because the honest reading is that a
 * student who cheats here is only cheating their own revision plan, and a
 * product that treats them as a suspect for opening a panel is worse than one
 * that trusts them and explains itself.
 *
 * A ref-count, not a boolean: the quiz runner and the card review can both
 * mount at once (dock panel plus full page), and a boolean would let whichever
 * unmounted first unlock the other one's session.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type Ctx = {
  /** True while at least one assessment is running. */
  assessing: boolean
  /** What is running, for the copy the composer shows. */
  reason: 'quiz' | 'review' | null
  begin: (reason: 'quiz' | 'review') => void
  end: (reason: 'quiz' | 'review') => void
}

const AssessmentCtx = createContext<Ctx | null>(null)

export function AssessmentProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<{ quiz: number; review: number }>({
    quiz: 0,
    review: 0,
  })

  const begin = useCallback((reason: 'quiz' | 'review') => {
    setCounts((c) => ({ ...c, [reason]: c[reason] + 1 }))
  }, [])

  const end = useCallback((reason: 'quiz' | 'review') => {
    // Floored at zero so a double-unmount (StrictMode, a fast route change)
    // cannot drive the count negative and leave the app permanently locked.
    setCounts((c) => ({ ...c, [reason]: Math.max(0, c[reason] - 1) }))
  }, [])

  const value = useMemo<Ctx>(() => {
    const reason = counts.quiz > 0 ? 'quiz' : counts.review > 0 ? 'review' : null
    return { assessing: reason !== null, reason, begin, end }
  }, [counts, begin, end])

  return <AssessmentCtx.Provider value={value}>{children}</AssessmentCtx.Provider>
}

export function useAssessment(): Ctx {
  const ctx = useContext(AssessmentCtx)
  if (!ctx) throw new Error('useAssessment must be used inside <AssessmentProvider>')
  return ctx
}

/**
 * Declare that this component is an assessment, for as long as it is mounted.
 *
 * Mount/unmount rather than explicit start/stop calls: a student who navigates
 * away mid-quiz, hits the back button or closes the panel has ended the
 * assessment just as surely as one who finishes it, and every one of those
 * paths already unmounts the component. Wiring it to the lifecycle means there
 * is no exit that forgets to unlock.
 */
export function useAssessmentLock(reason: 'quiz' | 'review', active = true): void {
  const { begin, end } = useAssessment()
  useEffect(() => {
    if (!active) return
    begin(reason)
    return () => end(reason)
  }, [reason, active, begin, end])
}
