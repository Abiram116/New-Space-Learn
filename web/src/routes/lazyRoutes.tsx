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
