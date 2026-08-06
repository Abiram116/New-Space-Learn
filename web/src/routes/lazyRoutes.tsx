import { lazy, Suspense, type ReactNode } from 'react'
import { PageSpinner } from '../components/ui/PageSpinner'

/**
 * The heaviest routes, split out of the initial bundle.
 *
 * They live here rather than inline in `App.tsx` because `RootRoute` also
 * renders Landing — importing it in both places eagerly would silently undo
 * the split, since a static import anywhere pulls the chunk back into the
 * main bundle.
 *
 *   - Notes carries the whole rich-text editor (ProseMirror/Tiptap), the
 *     largest dependency in the app, and most sessions never open it.
 *   - Landing carries the scroll/parallax machinery and is only ever seen
 *     signed-out, yet shipped to signed-in users on every load.
 *   - Flashcards and Quizzes are self-contained screens with their own
 *     review/runner state machines.
 *
 * Everything on the critical path to a signed-in first paint (shell, Home,
 * chat) stays eagerly imported — lazily loading those would trade one
 * download for two round trips.
 */
export const Landing = lazy(() =>
  import('../features/landing/Landing').then((m) => ({ default: m.Landing })),
)
export const NotesView = lazy(() =>
  import('../features/notes/NotesView').then((m) => ({ default: m.NotesView })),
)
export const FlashcardsView = lazy(() =>
  import('../features/flashcards/FlashcardsView').then((m) => ({ default: m.FlashcardsView })),
)
export const QuizzesView = lazy(() =>
  import('../features/quizzes/QuizzesView').then((m) => ({ default: m.QuizzesView })),
)

export function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageSpinner />}>{children}</Suspense>
}

/**
 * Warm the split chunks once the app is idle.
 *
 * Splitting these out made the first paint much cheaper, but it moves the
 * cost to whenever a tab is first opened — which is exactly when the user
 * is waiting on it. Fetching during idle time gets both: a small entry
 * bundle *and* an instant first open, because the chunk is already in the
 * browser cache by the time it's asked for.
 *
 * Deliberately fire-and-forget: a failed prefetch is not an error, it just
 * means the chunk loads normally on demand.
 */
type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
}

export function prefetchRouteChunks(): void {
  const warm = () => {
    void import('../features/flashcards/FlashcardsView')
    void import('../features/quizzes/QuizzesView')
    void import('../features/notes/NotesView')
  }
  const idle = (window as IdleWindow).requestIdleCallback
  // Safari has no requestIdleCallback; a short timer is a fine stand-in.
  if (idle) idle(warm, { timeout: 4000 })
  else window.setTimeout(warm, 2000)
}
