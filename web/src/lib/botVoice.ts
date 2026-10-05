/**
 * The bots' voice: short, casual, first-person lines per situation and agent.
 * Nova is calm and warm, Flip is bouncy, Pop is excitable, Jot is thoughtful and a
 * little dry. A light joke is fine; a made-up fact never is.
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
  /** Where the line is shown, when the base pool would say something untrue
   *  there. A situation with a `<situation>.<surface>` pool uses it INSTEAD
   *  of the base pool: `phone` has no chat (never promise one), `home` is not
   *  inside a topic (never say "this topic"). Never printed. */
  surface?: 'phone' | 'home'
  /** Prefer lines that say the student's name, when one is given — for a
   *  greeting that should read as personal, not generic. Never printed. */
  personal?: boolean
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

/** Keyed by situation, `greeting.<daypart>` for time-of-day greetings, or
 *  `<situation>.<surface>` for a surface's own wording (replaces the base pool). */
export const LINES: Record<string, Pool> = {
  greeting: {
    any: ['Hey {name}! Good to see you.', 'Hi {name}! What are we learning today?', 'Hey! Pick a topic and let’s go.'],
    tutor: ['Hi, I’m {bot}. Ask me anything and I’ll show you the page it came from.', 'Take your time. Ask whatever you like.'],
    cards: ['{bot} here! Got something worth remembering?', 'Hey, it’s {bot}. Let’s make some cards.'],
    quiz: ['{bot} here! Ready to see what stuck?', 'Hey hey! Want a quick quiz?'],
    notes: ['{bot} here. Let’s write down the good bits.', 'Hi, it’s {bot}. I’ll keep the notes, you keep the ideas.'],
  },
  'greeting.home': {
    any: ['Hey {name}! Good to see you.', 'Hi {name}! What are we learning today?', 'Hey! Ready when you are.'],
  },
  'greeting.morning': {
    any: ['Morning, {name}! Let’s ease into it.', 'Good morning! Coffee is optional, curiosity is not.'],
  },
  'greeting.afternoon': {
    any: ['Afternoon, {name}! Let’s get a little done.', 'Good afternoon! A good time for a quick session.'],
  },
  'greeting.evening': {
    any: ['Evening, {name}! Let’s make tonight count.', 'Good evening! Study lamp on, ready when you are.'],
  },
  'greeting.late': {
    any: ['Up late, {name}? I’m here too.', 'Late-night crew, checking in!', 'Still up? Let’s keep it short and sweet.'],
  },
  firstRun: {
    any: [
      'Hi {name}, I’m {bot}! Add a PDF or some notes and we’ll dive in.',
      'Welcome! Add a document to a topic and I’ll help you study it.',
      'I’m {bot}. Upload something you’re studying, then ask me about it.',
    ],
  },
  waking: {
    any: [
      'Yawn… waking things up. Back in a moment.',
      'Just stretching! Starting up now.',
      'Warming up. Thanks for waiting.',
      'Rise and shine, servers!',
    ],
  },
  slow: {
    any: [
      'Still on it. This one’s taking a bit.',
      'Hang tight, I’m still working.',
      'Taking the scenic route. Nearly there.',
      'Thanks for waiting. Still going!',
    ],
    tutor: ['Still reading your pages. No rush.'],
    notes: ['Still writing. Tidy takes a minute.', 'Pen’s moving. Almost there.'],
    cards: ['Still shuffling… nearly dealt!', 'Cutting the deck. One more second.'],
    quiz: ['Still cooking up questions. Hang tight!', 'Warming up the buzzers. Almost go time.'],
  },
  error: {
    any: [
      'Oops, that one’s on me. Try again?',
      'That didn’t work. Want to give it another go?',
      'Something broke on my end, not yours. Try again?',
      'Hmm, that didn’t go through. Try again?',
    ],
    tutor: ['Hmm, I lost my place. Shall we try that again?'],
    notes: ['Ink smudged on that one. Mind trying again?', 'Margin note: that didn’t save. Retry?'],
    cards: ['Dropped the deck! Give it another shuffle?', 'Misdeal. Let’s try that hand again.'],
    quiz: ['Oof, fumbled that one! Go again?', 'Buzzer’s stuck. Try that round again?'],
  },
  success: {
    any: ['Done! Take a look.', 'All set. Hope it helps!'],
    tutor: ['There you go!', 'All yours. Ask me if anything’s unclear.'],
    cards: ['Fresh deck: {count:card:cards}. Dealt!', 'Deck’s ready. Flip when you like.'],
    quiz: ['Quiz is up: {count:question:questions}. Good luck!', 'Your quiz is live. Buzzers ready!'],
    notes: ['Noted. All written up.', 'Your note is ready. Neat and tidy.'],
  },
  generating: {
    tutor: ['Reading through your docs…', 'Thinking it over…', 'Finding the right page…'],
    cards: ['Shuffling up {count:card:cards}…', 'Dealing you a fresh deck…', 'Turning this into flashcards…'],
    quiz: ['Writing {count:question:questions}…', 'Cooking up some questions…', 'Picking questions worth asking…'],
    notes: ['Jotting it down…', 'Tidying this into a note…', 'Adding bullets and margins…'],
  },
  streak: {
    any: [
      '{streak:day:days} in a row! That’s a real streak.',
      'Streak kept: {streak:day:days}. Nice, {name}!',
      'Streak safe for today. Nicely done!',
      'Day {streak}! Look at you go.',
    ],
  },
  goal: {
    any: ['Daily goal done! {count} today, {name}.', 'You hit today’s goal. Nice one!', 'Goal done. Anything extra is a bonus.'],
  },
  quizGreat: {
    any: ['{score}%! You really know this.', 'Great run, {name}. {score}% is a great score.', 'Wow, that stuck!'],
    quiz: ['{score}%! Confetti time!', 'Boom, {name}! {score}% and the crowd goes wild.', 'Champion move! That really stuck.'],
  },
  quizOk: {
    any: ['{score}%, solid! A quick review will cover the rest.', 'Good work. The ones you missed are worth another look.'],
    quiz: ['{score}%, nice round! The misses are easy points next time.', 'Solid! Fix the few that slipped and you’re golden.'],
  },
  quizRough: {
    any: [
      '{score}% this time. That’s what practice is for.',
      'Tough one! The misses show what to look at next.',
      'Every miss is a clue. Want to go over them together?',
    ],
    quiz: [
      '{score}% this round. Shake it off, rematch?',
      'Tough set! The misses tell us what to practice.',
      'Everyone whiffs sometimes. Let’s turn these into points.',
    ],
  },
  welcomeBack: {
    any: ['Welcome back, {name}! Pick up wherever you like.', 'Hey, you’re back! Good to see you.', 'Welcome back! Let’s just start.'],
  },
  emptyCards: {
    any: ['No cards yet. Your first deck is one chat away.'],
    cards: ['No cards yet. Ask something in chat and I’ll turn it into a deck.'],
  },
  emptyQuizzes: {
    any: ['No quizzes yet. Chat about a topic and it can become one.'],
    quiz: ['No quizzes yet. Chat about a topic and I’ll quiz you on it.'],
  },
  'emptyCards.phone': {
    any: ['No cards yet. Make a deck from your material, or write the first card.'],
    cards: ['No cards yet. Tap Generate and I’ll deal you a deck.'],
  },
  emptyNotes: {
    any: ['No notes yet. Any chat can become one.'],
    notes: ['No notes yet. I can write one from any chat.'],
  },
  'emptyNotes.phone': {
    any: ['No notes yet. Start one here, or have one written from your material.'],
    notes: ['No notes yet. Start one here, or I can write one for you.'],
  },
  'emptyQuizzes.phone': {
    any: ['No quizzes yet. Make one from your material.'],
    quiz: ['No quizzes yet. Tap Generate and I’ll quiz you on your material.'],
  },
  emptyDocs: {
    any: ['No documents yet. Add a PDF and I’ll read it with you.', 'This topic is empty. Upload something and let’s start.'],
  },
  sessionEnd: {
    any: ['Nice session, {name}. See you next time!', '{count:card:cards} reviewed. That’s real progress.', 'Good work today. Rest counts too.', 'That’s a wrap! Come back whenever you like.'],
    cards: ['{count:card:cards} flipped. Clean deal!', 'Deck done, {name}. Shuffle you later!', 'All flipped. Nice work today.'],
  },
  nudge: {
    any: [
      '{count:card is:cards are} due whenever you’re ready.',
      'Quick review? {count:card:cards} waiting, no rush.',
      'Got a few minutes? A short review goes a long way.',
      'Your cards are ready when you are. They’re very patient.',
    ],
    cards: ['{count:card is:cards are} due. Quick flip?', 'A few cards want a turn. No rush!', 'Your deck’s waiting. It’s very patient.'],
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
  const own = facts.surface ? `${situation}.${facts.surface}` : null
  const keys: string[] = [own && LINES[own] ? own : situation]
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
  if (facts.personal && has(facts, 'name')) {
    const named = out.filter((l) => placeholders(l).includes('name'))
    if (named.length > 0) return named
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
