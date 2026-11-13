import { titleForPath, useDocumentTitle } from '../lib/useDocumentTitle'

/**
 * Names the browser tab for the page at `pathname`. Rendered once, beside the
 * routes in `App.tsx`. Topic addresses are left to `TopicCanonical`.
 */
export function RouteTitle({ pathname }: { pathname: string }) {
  useDocumentTitle(titleForPath(pathname))
  return null
}
