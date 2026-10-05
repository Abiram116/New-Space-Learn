/**
 * Where to send someone after sign-in, from a `?next=` they arrived with.
 *
 * The value is in the URL, so anyone can write it: a link to
 * `/signin?next=https://evil.example` must not end with a freshly signed-in
 * student on someone else's site. Only a path on this site is accepted — one
 * that starts with a single `/`. `//host` and `/\host` are other origins to a
 * browser, and anything with a scheme (`https:`, `javascript:`) is refused.
 */
export function safeNext(raw: string | null | undefined, fallback = '/home'): string {
  if (!raw) return fallback
  const value = raw.trim()
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  // Control characters (a tab or newline inside `/\t/evil.example`) are
  // stripped by URL parsers, which can turn a path back into `//host`.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback
  try {
    const url = new URL(value, 'https://space-learn.invalid')
    if (url.origin !== 'https://space-learn.invalid') return fallback
    return url.pathname + url.search + url.hash
  } catch {
    return fallback
  }
}

/** Whether a link may be opened from a note or an answer: web and mail only. */
export function isSafeExternalHref(href: string): boolean {
  try {
    const url = new URL(href, window.location.origin)
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}
