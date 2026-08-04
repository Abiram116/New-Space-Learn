export type AgentKey = 'notes' | 'quiz' | 'flashcards' | 'skills'

export const AGENT_LABELS: Record<AgentKey, string> = {
  notes: 'Notes',
  quiz: 'Quiz',
  flashcards: 'Cards',
  skills: 'Skills',
}
