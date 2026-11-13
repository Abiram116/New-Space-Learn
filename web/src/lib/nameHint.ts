/**
 * A gentle nudge when a subject or topic is named something the tutor cannot
 * make sense of.
 *
 * The name is not decoration: every answer, quiz and card in a topic is read in
 * that topic's sense ("transformer" under Deep Learning is the model, under
 * Electrical Machines it is the device). A name like "blah" or "asdf" gives the
 * tutor nothing to read it by, and a one- or two-letter name can mean anything.
 * This only suggests; it never blocks, because a real name can look odd
 * ("C", "R", "Lisp"), and the student knows what they mean.
 */

const PLACEHOLDERS = new Set([
  'test', 'testing', 'tests', 'asdf', 'asdfg', 'qwerty', 'blah', 'foo', 'bar', 'baz', 'temp', 'tmp', 'untitled',
  'new', 'new topic', 'new subject', 'topic', 'subject', 'topic 1', 'subject 1', 'stuff', 'misc', 'random', 'abc',
  'abcd', 'xyz', 'hello', 'hi', 'sample', 'demo', 'trial', 'xxx', 'aaa', 'lorem', 'ipsum', 'sdf', 'dfg',
])

const KEYBOARD_ROWS = ['qwert', 'asdf', 'zxcv', 'hjkl', 'yuiop', 'wert', 'sdfg', 'dfgh']

export const NAME_HINT = 'Use the real name, like “Binary Trees”. The tutor reads every answer in this topic’s sense, so a clear name gives clearer answers.'
export const SHORT_NAME_HINT = 'Very short names can mean many things. A few more words help the tutor read it the way you mean, like “C programming”.'

/** A hint to show under the name field, or null when the name is fine (or empty). */
export function nameHint(raw: string): string | null {
  const name = raw.trim().toLowerCase()
  if (name.length === 0) return null
  if (PLACEHOLDERS.has(name)) return NAME_HINT
  if (/^[\d\s\W_]+$/.test(name)) return NAME_HINT // digits and symbols only
  const letters = name.replace(/[^a-z]/g, '')
  if (!/\s/.test(name) && letters.length === name.length) {
    // No vowels reads as mashing ("bcdfg"), unless it is written like an acronym ("DBMS", "CNNs").
    const acronym = /^[A-Z]{2,}s?$/.test(raw.trim())
    if (name.length >= 4 && !acronym && !/[aeiouy]/.test(name)) return NAME_HINT
    if (/^(.)\1{2,}$/.test(name)) return NAME_HINT // "aaaa"
    if (name.length >= 4 && KEYBOARD_ROWS.some((row) => name.includes(row))) return NAME_HINT // "asdfjkl"
  }
  if (letters.length > 0 && letters.length <= 2 && !/\s/.test(name)) return SHORT_NAME_HINT
  return null
}
