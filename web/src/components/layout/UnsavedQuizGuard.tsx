import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAssessmentOptional } from '../../lib/assessment'
import { ConfirmDialog } from '../ui/ConfirmDialog'

/**
 * Asks before a click on any in-app link throws away a quiz in progress.
 *
 * A quiz keeps its answers in the page and only sends them on "See results",
 * so a click on the sidebar — Cards, a topic, Home — silently discarded
 * everything. The quiz's own Leave button already asks; this makes the rest of
 * the app agree. One capture-phase listener on the document rather than a check
 * in every link, so nothing that links away can forget to ask. Also warns on a
 * tab close or refresh.
 */
export function UnsavedQuizGuard() {
  const unsaved = useAssessmentOptional()?.unsaved ?? false
  const navigate = useNavigate()
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    if (!unsaved) return
    const here = () => location.pathname + location.search + location.hash
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.origin !== location.origin) return
      const to = a.pathname + a.search + a.hash
      if (to === here()) return
      e.preventDefault()
      e.stopPropagation()
      setPending(to)
    }
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    document.addEventListener('click', onClick, true)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [unsaved])

  return (
    <ConfirmDialog
      open={pending !== null}
      title="Leave this quiz?"
      description="Your answers are saved only when you see your results, so this try won't count."
      confirmLabel="Leave quiz"
      destructive
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const to = pending
        setPending(null)
        if (to) navigate(to, { state: { nav: true } })
      }}
    />
  )
}
