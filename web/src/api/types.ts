/** Response shapes shared across resource modules. */

export type Tone = 'brand' | 'sky' | 'mint' | 'sun' | 'coral' | 'azure' | 'jade'

export type Me = { id: string; email: string | null }

export type Space = {
  id: string
  name: string
  tone: Tone
  subspaces: Subspace[]
}

export type Subspace = {
  id: string
  subject_id: string
  name: string
  last_activity_at: string | null
  counts: { docs?: number; notes?: number; quizzes?: number; cards?: number }
}

export type Citation = {
  marker: number
  document_id: string
  document_name: string
  locator: string
  snippet: string
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  citations?: Citation[] | null
  created_at: string
}

export type DocStatus = 'uploading' | 'processing' | 'ready' | 'failed'

export type Document = {
  id: string
  name: string
  mime_type: string | null
  size_bytes: number | null
  status: DocStatus
  error: string | null
  created_at: string
  ready_at: string | null
}

export type Note = {
  id: string
  title: string
  body_md: string
  origin: 'user' | 'agent' | 'doc'
  source_ids: string[] | null
  updated_at: string
}

export type Deck = {
  id: string
  name: string
  total: number
  due: number
  known_pct: number
}

export type Flashcard = {
  id: string
  deck_id: string
  front: string
  back: string
  source: string | null
  ease: number
  interval_days: number
  reps: number
  due_at: string
}

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export type QuizQuestion = {
  q: string
  choices: string[]
  answer_index: number
  source?: string | null
}

export type Quiz = {
  id: string
  topic: string | null
  questions: QuizQuestion[]
  created_at: string
}

export type QuizResult = {
  score: number
  correct: boolean[]
}

export type MemoryScope = 'session' | 'topic' | 'all'

export type Skill = {
  id: string
  name: string
  icon: string
  tone: Tone
  description: string | null
  instructions: string
  capabilities: string[]
  memory_scope: MemoryScope
  output_format: string | null
  is_library: boolean
}

export type BadgeTier = 'common' | 'rare' | 'elite'

export type Badge = {
  id: string
  label: string
  /** An Icon name from the drawn set — never an emoji. */
  icon: string
  tone: Tone
  tier: BadgeTier
  earned: boolean
  /** How to earn it. Shown on locked badges so they aren't dead ends. */
  hint: string
}

export type BriefSuggestion = {
  label: string
  /** In-app route, e.g. "/s/:spaceId/:subspaceId/flashcards". */
  route: string
}

export type TopicSignal = {
  subspace_id: string
  topic: string
  average: number
}

export type StudentModel = {
  learning_style: string | null
  session_length_minutes: number | null
  exam_context: string | null
  teaching_preference: string | null
  /** Computed from real quiz averages — never sent on PATCH. */
  weak_areas: TopicSignal[]
  strong_areas: TopicSignal[]
  streak_days: number
}

export type StudentModelPatch = Partial<
  Pick<StudentModel, 'learning_style' | 'session_length_minutes' | 'exam_context' | 'teaching_preference'>
>

export type Brief = {
  headline: string
  body: string
  /** false when the backend used deterministic copy instead of the model. */
  generated: boolean
  /** A concrete next action computed from real data, or null if nothing stands out. */
  suggestion: BriefSuggestion | null
}

export type HeatmapCell = { day: string; intensity: number }

export type Stats = {
  streak_days: number
  max_streak: number
  study_minutes_this_week: number
  cards_due: number
  quiz_average: number | null
  docs_indexed: number
  spaces_count: number
  heatmap: HeatmapCell[]
  badges: Badge[]
}

export type Settings = {
  daily_goal: number
  reminder_time: string | null
  streak_freeze_enabled: boolean
  spaced_pace: 'relaxed' | 'balanced' | 'aggressive'
  answer_only_from_docs: boolean
  always_show_citations: boolean
}
