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

export function suggestFor(asked: number): string {
  return IDEAS[Math.max(0, asked) % IDEAS.length]
}
