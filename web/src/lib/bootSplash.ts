/**
 * Tearing down the pre-React splash in `index.html`.
 *
 * The splash is markup the browser can paint before any JavaScript has run.
 * This is the other half: deciding when the app is genuinely ready to be
 * looked at, and getting the splash out of the way without a jolt.
 *
 * **"Ready" means auth has resolved**, not "React mounted". Routing is a
 * function of whether there is a session, so removing the splash any earlier
 * shows a frame of the signed-out layout to someone who is signed in — the
 * exact stutter this exists to prevent. `AuthProvider` calls this once it
 * knows.
 *
 * Two guards worth their lines:
 *
 * - **A minimum on-screen time.** A splash that appears and vanishes inside
 *   80ms reads as a glitch, not as loading. If everything was cached and auth
 *   came back instantly, it holds briefly so the exit is a deliberate fade.
 * - **A hard ceiling.** If auth never resolves — offline, a dead Supabase —
 *   the splash must still leave, or a network failure becomes an infinite
 *   loading screen with no way to reach the sign-in page. Failing to an
 *   interactive app beats failing to a hostage screen.
 */

/** Below this, the splash reads as a flash rather than as loading. */
const MIN_VISIBLE_MS = 450

/** Above this, something is wrong and the user needs the app anyway. */
const MAX_WAIT_MS = 8000

/** Matches the CSS transition in `index.html`; removing sooner cuts the fade. */
const FADE_MS = 420

const startedAt = Date.now()
let done = false

/**
 * Screens that still have work to do before the app is worth looking at.
 *
 * Without this the splash came down the moment auth resolved, and then
 * `OnboardingGate` — which has to fetch the student model before it knows
 * whether to show the app or the intake — put up its own full-page circular
 * spinner. Two loading screens back to back, the second one generic, which
 * makes the first look like a decoration rather than the app starting.
 *
 * A holder defers the teardown until it releases. `hideBootSplash` still says
 * "as far as I'm concerned we're ready"; the splash simply doesn't leave while
 * anyone is still holding. The failsafe ceiling ignores holds entirely, so a
 * holder that never releases cannot strand anyone.
 */
let holds = 0
/** Set once someone has asked to hide, so the last release can finish the job. */
let hideRequested = false

function tearDown(el: HTMLElement) {
  if (done) return
  done = true
  el.setAttribute('data-hidden', 'true')
  // Removed rather than left hidden: it sits at z-index 9999 over everything,
  // and a `visibility: hidden` overlay is one CSS mistake away from
  // swallowing every click on the page.
  window.setTimeout(() => el.remove(), FADE_MS)
}

export function hideBootSplash(): void {
  hideRequested = true
  if (holds > 0) return
  const el = document.getElementById('boot')
  if (!el) return
  const elapsed = Date.now() - startedAt
  const wait = Math.max(0, MIN_VISIBLE_MS - elapsed)
  window.setTimeout(() => {
    // Re-checked on the way out: a holder can register during the minimum
    // visible window, and tearing down anyway would reintroduce the exact
    // second-spinner this exists to prevent.
    if (holds === 0) tearDown(el)
  }, wait)
}

/**
 * Keep the splash up while this screen decides what to render.
 *
 * Returns its own release function so a caller cannot release someone else's
 * hold, and so a `useEffect` can simply return it as the cleanup.
 */
export function holdBootSplash(): () => void {
  holds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
    // The last one out finishes what `hideBootSplash` started. If nobody ever
    // asked to hide, this does nothing — releasing a hold is not itself a
    // claim that the app is ready.
    if (holds === 0 && hideRequested) hideBootSplash()
  }
}

/**
 * Start the failsafe. Called once at module load from `main.tsx`, so the
 * ceiling is running before anything can go wrong rather than being armed by
 * the code path that might not be reached.
 */
export function armBootSplashFailsafe(): void {
  window.setTimeout(() => {
    // Deliberately ignores `holds`. A holder that never releases — a hung
    // fetch, a screen that threw before its cleanup ran — must not be able to
    // convert a slow request into a permanent splash.
    const el = document.getElementById('boot')
    if (el) tearDown(el)
  }, MAX_WAIT_MS)
}
