/**
 * The agent-bot family: one silhouette, four crews.
 *
 * Rename the tutor here and nowhere else — every greeting, label and voice
 * line reads `BOT_NAME` / `AGENTS[id].name`.
 */

export const BOT_NAME = 'Nova'

export type AgentId = 'tutor' | 'cards' | 'quiz' | 'notes'

export const AGENT_IDS: readonly AgentId[] = ['tutor', 'cards', 'quiz', 'notes']

export interface AgentMeta {
  id: AgentId
  /** Display name. The tutor's is `BOT_NAME`. */
  name: string
  /** Shell colour token (a `--color-*` name from index.css). */
  tone: 'brand' | 'azure' | 'sun' | 'jade'
  /** Resolved CSS colours, with fallbacks so the bot renders outside the app too. */
  color: string
  tip: string
  /** One line: what this agent does. */
  role: string
  /** How it introduces itself. */
  greeting: string
}

export const AGENTS: Record<AgentId, AgentMeta> = {
  tutor: {
    id: 'tutor',
    name: BOT_NAME,
    tone: 'brand',
    color: 'var(--color-brand, #ff5a3c)',
    tip: 'var(--color-sun, #ffc53d)',
    role: 'Your tutor. Explains your topic from your own docs, with the page cited.',
    greeting: `Hi, I'm ${BOT_NAME}! Ask me anything about this topic.`,
  },
  cards: {
    id: 'cards',
    name: 'Flip',
    tone: 'azure',
    color: 'var(--color-azure, #5590ff)',
    tip: 'var(--color-sky, #35d6e8)',
    role: 'Turns what you just learned into a deck of flashcards.',
    greeting: "Hey, I'm Flip. Point me at a chat and I'll deal you a deck.",
  },
  quiz: {
    id: 'quiz',
    name: 'Pop',
    tone: 'sun',
    color: 'var(--color-sun, #ffc53d)',
    tip: 'var(--color-coral, #ff3d8b)',
    role: 'Builds quizzes from your material so you can check what stuck.',
    greeting: "I'm Pop. Quizzes are kind of my whole thing.",
  },
  notes: {
    id: 'notes',
    name: 'Jot',
    tone: 'jade',
    color: 'var(--color-jade, #22d3a0)',
    tip: 'var(--color-mint, #b8ff3c)',
    role: 'Writes tidy notes from your conversations.',
    greeting: "I'm Jot. I'll write down the good bits so you don't have to.",
  },
}
