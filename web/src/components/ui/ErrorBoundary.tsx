/**
 * React error boundary → friendly card. Wraps the whole app.
 *
 * Rendering-time bugs land here (not run-time API errors — those go through
 * the toast system). Users see a calm apology + a retry button; the console
 * still gets the full stack in dev.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
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
          <button
            onClick={this.reset}
            className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white cursor-pointer"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl border-[1.5px] border-line bg-surface px-4 py-2.5 text-sm font-semibold cursor-pointer"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
