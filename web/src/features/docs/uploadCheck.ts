/**
 * What the server will refuse, said before the upload instead of after it.
 *
 * A file dragged in skips the picker's `accept` filter, and a file over the
 * limit used to be sent in full before the server answered "too large". Both
 * rules mirror `api/app/services/uploads.py` (`_ALLOWED_EXT`,
 * `_ALLOWED_MIME_PREFIXES`, `MAX_BYTES`); the server still checks, this only
 * saves the wait.
 */

export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024

const EXTENSIONS = new Set(['pdf', 'txt', 'md', 'markdown', 'csv', 'png', 'jpg', 'jpeg', 'webp'])
const MIME_PREFIXES = ['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'image/png', 'image/jpeg', 'image/webp']

/** The reason this file cannot be added, in words for the screen; null when it can. */
export function uploadProblem(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  const type = (file.type || '').toLowerCase()
  const supported = EXTENSIONS.has(ext) || MIME_PREFIXES.some((p) => type.startsWith(p))
  if (!supported) return `“${file.name}” can’t be read. Add a PDF, a text, Markdown or CSV file, or an image.`
  if (file.size > UPLOAD_MAX_BYTES) return `“${file.name}” is larger than the 20 MB limit.`
  return null
}
