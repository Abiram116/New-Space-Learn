/**
 * Agent bots: the faces of Space Learn's AI agents.
 *
 * One silhouette (head-heavy screen-face bot, stubby arms, antenna with a
 * glowing tip), four crew members told apart by shell colour, antenna tip and
 * a chest emblem:
 *
 *   tutor  "Nova" (BOT_NAME)  brand orange, gold star tip      the chat tutor
 *   cards  "Flip"             azure, sky card tip              flashcard agent
 *   quiz   "Pop"              sun gold, coral "?" tip          quiz agent
 *   notes  "Jot"              jade, lime pencil tip            notes agent
 *
 * Rename in `agents.ts` (BOT_NAME / AGENTS) and nowhere else.
 *
 * ── Components ────────────────────────────────────────────────────────────
 *   <Bot agent="quiz" mood="thinking" size={96} />
 *     Decorative (aria-hidden) unless `label` is given, then role="img".
 *     `look` lets idle eyes follow the pointer. Reads down to 48px.
 *
 *   <BotSays agent="tutor" mood="wave" layout="inline|stacked" showName live>
 *     {pickLine('greeting', 'tutor', { name })}
 *   </BotSays>
 *     Bot + speech bubble. The line is real text; `live` makes it a polite
 *     status region. The bubble re-enters whenever the line changes.
 *
 *   <BotProgress agent="cards" line={pickLine('generating', 'cards', { count })}
 *                startedAt={t0} running bar />
 *     Working bot + line + elapsed clock (updated in place, no re-renders)
 *     + indeterminate bar. Pass mood="oops" / "happy" and running={false} at the end.
 *
 *   const mood = useBotMood(situation)
 *     situation → mood: idle→idle (with occasional lookaround), loading→working,
 *     slow→thinking, error→oops, success→happy (settles to idle),
 *     celebrate→celebrate (settles), asleep→sleepy. Leaving `asleep` plays
 *     `waking` first.
 *
 * ── Moods ─────────────────────────────────────────────────────────────────
 *   idle · lookaround · wave · happy · celebrate · proud · cheer · thinking ·
 *   working · curious · encouraging · sleepy · waking · oops
 *   Pose changes tween (eyes squash into their next shape, arms swing, head
 *   tilts); loops pause offscreen; under prefers-reduced-motion every mood is
 *   a still key pose.
 *
 * ── Voice ─────────────────────────────────────────────────────────────────
 *   `pickLine(situation, agent, facts)` from `lib/botVoice`. Only pass real
 *   facts ({ name, count, score, streak }); lines needing absent facts are skipped.
 *
 * ── Where these belong (not wired yet) ────────────────────────────────────
 *   Agent run progress cards   BotProgress, agent = cards/quiz/notes, 'generating' → 'success' | 'error'
 *   Cold start / OfflineBanner Bot mood 'sleepy' → 'waking' (useBotMood 'asleep'), pickLine('waking'), then 'slow'
 *   Empty states               BotSays stacked + 'emptyCards' | 'emptyQuizzes' | 'emptyNotes' | 'emptyDocs'
 *   Celebrations               'celebrate' / 'cheer' / 'proud' with 'streak' | 'goal' | 'quizGreat' lines
 *   Error states               'oops' + pickLine('error'), next to the retry button
 *   Onboarding / first run     'wave' + 'firstRun'
 *   Today greeting             BotSays inline, 'wave' → idle, pickLine('greeting' | 'welcomeBack', 'tutor', { name })
 */
export { Bot, type BotProps } from './Bot'
export { BotSays, type BotSaysProps } from './BotSays'
export { BotProgress, formatElapsed, type BotProgressProps } from './BotProgress'
export { useBotMood, SITUATION_MOOD, type BotSituation, type BotMoodOptions } from './useBotMood'
export { AGENTS, AGENT_IDS, BOT_NAME, type AgentId, type AgentMeta } from './agents'
export { BOT_MOODS, POSES, type BotMood } from './moods'
