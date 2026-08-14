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

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[boundary]', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-coral-soft text-coral-deep">
          <Icon name="alert" size={24} />
        </span>
        <h1 className="font-display text-2xl font-semibold">Something went sideways</h1>
        <p className="text-sm text-muted">
          The page hit an unexpected error. Try again, and if it keeps happening,
          reload — your work is saved.
        </p>
        <div className="flex gap-2">
          {/* Hand-rolled buttons here used to set `text-white` on the brand
              background — every other brand-colored control in the app uses
              the dark `#1a120f` text `Button`'s `primary` variant defines,
              because brand is a bright color: white measures ~3.1:1 against
              it (fails WCAG AA's 4.5:1 for normal text), the dark text
              ~6.1:1. Using the real component instead of a parallel copy of
              its styling is what keeps the two from drifting apart again. */}
          <Button onClick={this.reset}>Try again</Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    )
  }
}
