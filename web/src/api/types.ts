/** Response shapes shared across resource modules. */

export type Tone = 'brand' | 'sky' | 'mint' | 'sun' | 'coral' | 'azure' | 'jade'

export type Me = { id: string; email: string | null }

export type Space = {
  id: string
  name: string
  tone: Tone
  /** Pinned subjects sort to the top of the rail. Server-ordered. */
  pinned: boolean
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
  /** Where the note lives. Only sent by the cross-topic listing — a title
   *  alone is ambiguous once you're looking at every subject at once. */
  subspace_id?: string | null
  subspace_name?: string | null
  subject_name?: string | null
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
  subtopic?: string | null
  /** Why the right answer is right. Shown the moment the student commits,
   *  not at the end. Absent on quizzes generated before the field existed. */
  explanation?: string | null
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
  duration_seconds?: number | null
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
  /** Where you actually stand against the threshold, e.g. 7 of 10 days.
   *  A hint alone tells you the rule but not whether you're one day away or
   *  have never started — the difference between a target and a wall. */
  progress: number
  target: number
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
  /** The subject the topic sits under — "Attention" is ambiguous once two
   *  subjects both have one. */
  subject?: string | null
  /** Later-half minus earlier-half quiz average, in points. Negative means
   *  getting worse; null when there aren't enough attempts to say. */
  trend?: number | null
  days_since_activity?: number | null
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
  /** Scores that are DROPPING — distinct from `weak_areas`, which are merely
   *  low. A topic climbing from 40% and one sliding from 85% need opposite
   *  advice, and an average can't separate them. */
  falling_areas: TopicSignal[]
  /** Real history, then silence. */
  cold_areas: TopicSignal[]
  /** What the app has observed the student doing — never a preference they
   *  stated. Kept apart from the explicit fields on purpose. */
  observed_habits: string[]
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

export type HeatmapCell = {
  day: string
  /** 0..3 — relative shading only. Use `minutes` for anything a user reads. */
  intensity: number
  minutes: number
}

/** Cards landing on one upcoming day. Index 0 is today, and includes overdue. */
export type ForecastDay = {
  day: string
  count: number
}

/** What the last seven days were spent on, not just how long they took. */
export type StudyComposition = {
  chat_messages: number
  cards_reviewed: number
  quizzes_taken: number
}

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
  /** The target the streak bars are measured against. */
  daily_goal: number
  composition: StudyComposition
  due_forecast: ForecastDay[]
}

export type Settings = {
  daily_goal: number
  reminder_time: string | null
  streak_freeze_enabled: boolean
  spaced_pace: 'relaxed' | 'balanced' | 'aggressive'
  answer_only_from_docs: boolean
  always_show_citations: boolean
}
