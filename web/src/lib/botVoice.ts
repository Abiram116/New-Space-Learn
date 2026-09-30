/**
 * The bots' voice: short, warm, first-person lines per situation and agent.
 *
 * Honesty rules (enforced by botVoice.test.ts):
 *  - A line may only interpolate facts the caller passed, and only the facts
 *    its situation allows (ALLOWED_FACTS). No invented events, memories or
 *    numbers. `{bot}` (the speaker's own name) is always allowed.
 *  - Lines whose facts are missing are skipped, and every pool keeps at least
 *    one fact-free line, so a caller with no facts still gets something true.
 *  - One or two sentences. No guilt for missed days, no fake urgency.
 *
 * Placeholders: `{name}`, `{count}`, `{score}`, `{streak}`, `{bot}`, and the
 * plural form `{count:card:cards}` → "1 card" / "4 cards".
 */
import { AGENTS, type AgentId } from '../components/mascot/agents'

export type VoiceSituation =
  | 'greeting'
  | 'firstRun'
  | 'waking'
  | 'slow'
  | 'error'
  | 'success'
  | 'generating'
  | 'streak'
  | 'goal'
  | 'quizGreat'
  | 'quizOk'
  | 'quizRough'
  | 'welcomeBack'
  | 'emptyCards'
  | 'emptyQuizzes'
  | 'emptyNotes'
  | 'emptyDocs'
  | 'sessionEnd'
  | 'nudge'

export interface VoiceFacts {
  /** The student's first name, exactly as stored. */
  name?: string
  /** Meaning per situation: success/generating = items made; goal = items done
   *  today; sessionEnd = cards reviewed this session; nudge = cards due now. */
  count?: number
  /** Quiz score, 0–100. */
  score?: number
  /** Current streak in days. */
  streak?: number
  /** Local hour 0–23 for greetings; defaults to the clock. Never printed. */
  hour?: number
}

type FactKey = 'name' | 'count' | 'score' | 'streak'

export const ALLOWED_FACTS: Record<VoiceSituation, readonly FactKey[]> = {
  greeting: ['name'],
  firstRun: ['name'],
  waking: [],
  slow: [],
  error: [],
  success: ['count'],
  generating: ['count'],
  streak: ['streak', 'name'],
  goal: ['count', 'name'],
  quizGreat: ['score', 'name'],
  quizOk: ['score', 'name'],
  quizRough: ['score', 'name'],
  welcomeBack: ['name'],
  emptyCards: [],
  emptyQuizzes: [],
  emptyNotes: [],
  emptyDocs: [],
  sessionEnd: ['count', 'name'],
  nudge: ['count', 'name'],
}

type Pool = Partial<Record<AgentId | 'any', readonly string[]>>

/** Keyed by situation, or `greeting.<daypart>` for time-of-day greetings. */
export const LINES: Record<string, Pool> = {
  greeting: {
    any: ['Hey {name}! Good to see you.', 'Hi {name}. What are we learning today?', 'Hello! Pick a topic and I’m all yours.'],
    tutor: ['Ask me anything about this topic. I’ll show you the page it came from.'],
    cards: ['Flip here. Got something worth remembering?'],
    quiz: ['Pop here! Want to see what stuck?'],
    notes: ['Jot here. Let’s get the good bits written down.'],
  },
  'greeting.morning': {
    any: ['Morning, {name}! Fresh brain, fresh start.', 'Good morning! Coffee optional, curiosity required.'],
  },
  'greeting.afternoon': {
    any: ['Afternoon, {name}. Let’s make a little progress.', 'Good afternoon! Nice time for a quick session.'],
  },
  'greeting.evening': {
    any: ['Evening, {name}! Let’s make tonight count.', 'Good evening. Study lamp on, ready when you are.'],
  },
  'greeting.late': {
    any: ['Burning the midnight oil, {name}? I’m here for it.', 'Late-night study crew, reporting in.', 'Still up? Let’s keep it short and sweet.'],
  },
  firstRun: {
    any: [
      'Hi {name}, I’m {bot}! Add a PDF or some notes and we’ll learn it together.',
      'Welcome aboard! Add a document to your topic and I’ll help you study it.',
      'I’m {bot}. Upload something you’re studying, then ask me anything about it.',
    ],
  },
  waking: {
    any: [
      'Yawn… waking the server up. Just a few seconds.',
      'One sec, I was napping between stars. Booting up!',
      'Warming up my circuits. Almost there.',
      'Rise and shine, servers! Give me a moment.',
    ],
  },
  slow: {
    any: [
      'Still on it. This one’s taking a little longer.',
      'Hang tight, I’m still working on it.',
      'Taking the scenic route through the galaxy. Nearly there.',
      'Thanks for waiting. Still going!',
    ],
  },
  error: {
    any: [
      'Oops, that one’s on me. Want to try again?',
      'My signal got lost somewhere in orbit. Give it another go?',
      'Something broke on my end, not yours. Try again?',
      'The server tripped over a cable. Retry when you’re ready.',
    ],
  },
  success: {
    any: ['Done! Take a look.', 'All set. Hope it helps!'],
    tutor: ['There you go!'],
    cards: ['Your deck is ready: {count:card:cards}.', 'Fresh deck, dealt!'],
    quiz: ['Quiz ready: {count:question:questions}.', 'Your quiz is ready. Good luck!'],
    notes: ['Your note is ready.', 'All written up. Have a look!'],
  },
  generating: {
    tutor: ['Reading through your docs…', 'Thinking this through.', 'Finding the right page.'],
    cards: ['Shuffling up {count:card:cards}…', 'Dealing you a fresh deck.', 'Turning this into flashcards.'],
    quiz: ['Writing {count:question:questions}…', 'Cooking up a quiz from your material.', 'Picking questions worth asking.'],
    notes: ['Jotting it all down…', 'Tidying this into a note.', 'Writing up the good bits.'],
  },
  streak: {
    any: [
      '{streak:day:days} in a row! That’s a real streak.',
      'Streak kept: {streak:day:days}. Nice orbit, {name}.',
      'Streak safe for today. Nicely done!',
      'Day {streak}! Consistency looks good on you.',
    ],
  },
  goal: {
    any: ['Daily goal done! {count} today, {name}.', 'You hit today’s goal. Proud of you!', 'Goal complete. Everything from here is bonus.'],
  },
  quizGreat: {
    any: ['{score}%! You really know this.', 'Stellar, {name}. {score}% is a great score.', 'Brilliant run. That material stuck!'],
  },
  quizOk: {
    any: ['{score}%, solid! A quick review will lock in the rest.', 'Good work. The ones you missed are worth another look.'],
  },
  quizRough: {
    any: [
      '{score}% this time. That’s what practice is for.',
      'Tough one! The misses show exactly what to review next.',
      'Every miss is a map. Want to go over them together?',
    ],
  },
  welcomeBack: {
    any: ['Welcome back, {name}! Pick up wherever you like.', 'Hey, you’re back! Good to see you.', 'Welcome back. No catching up needed, let’s just start.'],
  },
  emptyCards: {
    any: ['No cards yet. Your first deck is one chat away.'],
    cards: ['No cards yet. Ask something in chat and I’ll turn it into a deck.'],
  },
  emptyQuizzes: {
    any: ['No quizzes yet. Chat about a topic and it can become one.'],
    quiz: ['No quizzes yet. Chat about a topic and I’ll quiz you on it.'],
  },
  emptyNotes: {
    any: ['No notes yet. Any chat can become one.'],
    notes: ['No notes yet. I can write one from any chat.'],
  },
  emptyDocs: {
    any: ['No documents yet. Add a PDF and I’ll read it with you.', 'This topic is empty. Upload something and let’s get started.'],
  },
  sessionEnd: {
    any: ['Nice session, {name}. See you next time!', '{count:card:cards} reviewed. That’s real progress.', 'Good work today. Rest counts too.', 'That’s a wrap! Come back whenever you’re ready.'],
  },
  nudge: {
    any: [
      '{count:card is:cards are} due whenever you’re ready.',
      'Quick review? {count:card:cards} waiting, no rush.',
      'Got a few minutes? A short review goes a long way.',
      'Your cards are ready when you are. No pressure, they’re very patient.',
    ],
  },
}

export function daypart(hour: number): 'morning' | 'afternoon' | 'evening' | 'late' {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'late'
}

const TOKEN = /\{(\w+)(?::([^:}]*):([^}]*))?\}/g

/** Placeholder keys a template uses (`{count:card:cards}` → `count`). */
export function placeholders(template: string): string[] {
  return [...template.matchAll(TOKEN)].map((m) => m[1])
}

function has(facts: VoiceFacts, key: string): boolean {
  if (key === 'bot') return true
  if (key === 'name') return typeof facts.name === 'string' && facts.name.trim().length > 0
  const v = facts[key as FactKey]
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

export function fill(template: string, agent: AgentId, facts: VoiceFacts): string {
  return template.replace(TOKEN, (_, key: string, one?: string, many?: string) => {
    if (key === 'bot') return AGENTS[agent].name
    if (key === 'name') return facts.name!.trim()
    const n = Math.round(facts[key as FactKey] as number)
    return one === undefined ? String(n) : `${n} ${n === 1 ? one : many}`
  })
}

/** Deterministic RNG for tests and seeded rotation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function candidates(situation: VoiceSituation, agent: AgentId, facts: VoiceFacts = {}): string[] {
  const keys: string[] = [situation]
  if (situation === 'greeting') keys.push(`greeting.${daypart(facts.hour ?? new Date().getHours())}`)
  const allowed = new Set<string>([...ALLOWED_FACTS[situation], 'bot'])
  const out: string[] = []
  for (const k of keys) {
    const pool = LINES[k]
    if (!pool) continue
    for (const line of [...(pool[agent] ?? []), ...(pool.any ?? [])]) {
      const keysUsed = placeholders(line)
      if (keysUsed.every((p) => allowed.has(p) && has(facts, p))) out.push(line)
    }
  }
  return out
}

/** A voice with its own short memory, so the same line never comes up twice running. */
export function createVoice(memory = 3) {
  const recent = new Map<string, string[]>()
  return function pick(situation: VoiceSituation, agent: AgentId = 'tutor', facts: VoiceFacts = {}, rng: () => number = Math.random): string {
    const pool = candidates(situation, agent, facts)
    if (pool.length === 0) return ''
    const slot = `${situation}|${agent}`
    const seen = recent.get(slot) ?? []
    const keep = Math.min(memory, pool.length - 1)
    const blocked = keep > 0 ? seen.slice(-keep) : []
    const fresh = pool.filter((l) => !blocked.includes(l))
    const choice = fresh[Math.min(fresh.length - 1, Math.floor(rng() * fresh.length))]
    recent.set(slot, [...seen, choice].slice(-memory))
    return fill(choice, agent, facts)
  }
}

const shared = createVoice()

/**
 * One line for this moment, in this agent's voice, from these real facts.
 * `pickLine('streak', 'tutor', { streak: 4, name: 'Asha' })`
 */
export function pickLine(situation: VoiceSituation, agent: AgentId = 'tutor', facts: VoiceFacts = {}, rng?: () => number): string {
  return shared(situation, agent, facts, rng)
}

/** Which quiz-result situation a score belongs to. */
export function quizSituation(score: number): 'quizGreat' | 'quizOk' | 'quizRough' {
  return score >= 80 ? 'quizGreat' : score >= 50 ? 'quizOk' : 'quizRough'
}
