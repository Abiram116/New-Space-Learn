import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Run `onReset` when the student clicks a primary nav link for the page they
 * are already on.
 *
 * Cards and Quizzes keep their sub-screens (a deck, a review, a quiz) partly
 * in component state, so the address barely changes while you drill in. A
 * click on "Cards" in the sidebar then went to the very same URL and nothing
 * happened — you could not get back to the list without finding a button on
 * the page. Primary nav links carry `state: { nav: true }`; a navigation the
 * page makes itself (opening a deck, `setSearchParams`) does not, so this
 * fires only for the click on the link.
 */
export function useNavReset(onReset: () => void): void {
  const { key, state } = useLocation()
  const seen = useRef(key)
  const reset = useRef(onReset)
  useEffect(() => {
    reset.current = onReset
  })
  const fromNav = (state as { nav?: boolean } | null)?.nav === true
  useEffect(() => {
    if (key === seen.current) return
    seen.current = key
    if (fromNav) reset.current()
  }, [key, fromNav])
}
