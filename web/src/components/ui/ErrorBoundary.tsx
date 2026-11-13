/**
 * React error boundary → friendly card. Wraps the whole app.
 *
 * Rendering-time bugs land here (not run-time API errors — those go through
 * the toast system). Users see a calm apology + a retry button; the console
 * still gets the full stack in dev.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'

type Props = {
  children: ReactNode
  /**
   * Clears the error when this changes. The shells pass the path, so a page
   * that failed to draw is left behind by going somewhere else, with the rail
   * or the tab bar still there to do it — rather than the error card
   * replacing the whole app until "Try again" happens to work.
   */
  resetKey?: string
}
type State = { error: Error | null }

/**
 * A screen's code could not be downloaded. Nearly always a tab left open
 * across a release: the file it asks for by name is gone. Retrying cannot
 * help (the failed import is remembered), a reload always does.
 */
function isStaleChunkError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i.test(text)
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[boundary]', error, info)
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset()
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    const stale = isStaleChunkError(this.state.error)
    return (
      <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-coral-soft text-coral-deep">
          <Icon name="alert" size={24} />
        </span>
        <h1 className="font-display text-2xl font-semibold">
          {stale ? 'This page needs a reload' : 'Something went wrong'}
        </h1>
        <p className="text-sm text-muted">
          {stale
            ? 'Space Learn was updated while this tab was open, or the connection dropped. Reload to carry on. Your work is saved.'
            : 'This page ran into a problem. Try again. If it keeps happening, reload the page. Your work is saved.'}
        </p>
        <div className="flex gap-2">
          {/* Hand-rolled buttons here used to set `text-white` on the brand
              background — every other brand-colored control in the app uses
              the dark `#1a120f` text `Button`'s `primary` variant defines,
              because brand is a bright color: white measures ~3.1:1 against
              it (fails WCAG AA's 4.5:1 for normal text), the dark text
              ~6.1:1. Using the real component instead of a parallel copy of
              its styling is what keeps the two from drifting apart again. */}
          {!stale && <Button onClick={this.reset}>Try again</Button>}
          <Button variant={stale ? 'primary' : 'secondary'} onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    )
  }
}
