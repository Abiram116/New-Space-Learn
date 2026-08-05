import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { friendlyMessage } from '../api/errors'

/**
 * React Router error element — catches loader/action errors at the route
 * layer. For render errors inside a page, the `ErrorBoundary` component
 * takes over.
 */
export function ErrorRoute() {
  const error = useRouteError()
  let title = 'Something went wrong'
  let message = friendlyMessage(error)

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = 'Nothing here'
      message = 'That page moved or never existed.'
    } else {
      title = `Error ${error.status}`
      message = error.statusText || message
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-coral-soft text-2xl">
        🌤️
      </span>
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted">{message}</p>
      <Link
        to="/home"
        className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white"
      >
        Go home
      </Link>
    </div>
  )
}
