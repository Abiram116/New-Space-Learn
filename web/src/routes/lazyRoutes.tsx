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
 *   - Chat carries react-markdown + remark-gfm + rehype-highlight — the
 *     heaviest dependency chain outside Notes — and was previously imported
 *     eagerly in App.tsx. That shipped chat's whole markdown stack to a
 *     signed-OUT visitor on /signin, who cannot reach chat until after
 *     signing in and picking a subspace. Docs, Profile, Settings and Skills
 *     were eager for no reason at all: none of them is where a signed-in
 *     session actually lands.
 *
 * Only `/home` is the true first paint for a signed-in session (see
 * RootRoute) — that one stays eager. Everything reached by a click FROM home
 * is split, same tier as Notes/Flashcards/Quizzes.
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
export const ChatView = lazy(() =>
  import('../features/chat/ChatView').then((m) => ({ default: m.ChatView })),
)
export const DocsView = lazy(() =>
  import('../features/docs/DocsView').then((m) => ({ default: m.DocsView })),
)
export const Profile = lazy(() =>
  import('../features/profile/Profile').then((m) => ({ default: m.Profile })),
)
export const Settings = lazy(() =>
  import('../features/settings/Settings').then((m) => ({ default: m.Settings })),
)
/** First run only, and never again — it must not sit in the entry bundle. */
export const Onboarding = lazy(() =>
  import('../features/onboarding/Onboarding').then((m) => ({ default: m.Onboarding })),
)
export const SkillsView = lazy(() =>
  import('../features/skills/SkillsView').then((m) => ({ default: m.SkillsView })),
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
    // Chat is the index route of every subspace — the single most likely
    // click from Home — so it is warmed first among the newly-split chunks.
    void import('../features/chat/ChatView')
    void import('../features/docs/DocsView')
  }
  const idle = (window as IdleWindow).requestIdleCallback
  // Safari has no requestIdleCallback; a short timer is a fine stand-in.
  if (idle) idle(warm, { timeout: 4000 })
  else window.setTimeout(warm, 2000)
}
