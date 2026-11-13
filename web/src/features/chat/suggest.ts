/**
 * The one question offered above the input. Plain, true of any file, and
 * different each time you come back to it: it steps along as you ask, so
 * the suggestion is never the thing you just asked.
 */
const IDEAS = [
  'Summarise the key ideas in my files',
  'What are the key terms I should know?',
  'Explain the hardest idea in simple words',
  'What might an exam ask about this?',
]

/** Three to start an empty chat from, as buttons. */
export const STARTERS = [IDEAS[0], IDEAS[1], IDEAS[3]]

/**
 * Openers for a topic that has no files yet, built from its own name: true of
 * any topic, so they work before there is anything to read. The answer comes
 * from general knowledge in the subject and says so (it is not their material);
 * the student sees them only when the topic's scope allows that.
 */
export function topicStarters(topic: string, subject: string): string[] {
  const t = topic.trim().slice(0, 60)
  if (!t) return []
  const s = subject.trim().slice(0, 40)
  const out = [`What is ${t}?`, `What do I need to know about ${t}?`]
  out.push(s && s.toLowerCase() !== t.toLowerCase() ? `Why does ${t} matter in ${s}?` : `Why does ${t} matter?`)
  out.push(`Give me a simple example of ${t}`)
  return out
}

export function suggestFor(asked: number): string {
  return IDEAS[Math.max(0, asked) % IDEAS.length]
}

/**
 * The question to offer when the last answer brought none of its own: the
 * first of this topic's starters not asked yet, then the generic ideas. A
 * starter names something in the student's own files; an idea is true of any.
 */
export function nextSuggestion(starters: readonly string[], asked: readonly string[]): string {
  const seen = new Set(asked.map((q) => q.trim().toLowerCase()))
  return starters.find((q) => !seen.has(q.trim().toLowerCase())) ?? suggestFor(asked.length)
}
