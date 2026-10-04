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
 *   `useBotLine(situation, agent, facts, key?)` holds one line steady across
 *   re-renders (a new one only when the moment changes). `surface: 'phone' |
 *   'home'` picks that surface's own pool where the base one would be untrue
 *   there (no chat on a phone; Home is not "this topic").
 *
 * ── Loading ───────────────────────────────────────────────────────────────
 *   `Bot` is light; the drawing (`BotFace` + mascot.css) is its own lazy
 *   chunk, fetched when the first bot mounts. Until then a size-exact
 *   `.bot-slot` holds the space. `loadBotFace()` warms it early (onboarding,
 *   celebrations). Tests preload it in testSetup (jsdom only).
 *
 * ── Where they live ───────────────────────────────────────────────────────
 *   Agent runs (chat)          AgentRunCard: BotProgress 48px, Flip/Pop/Jot, generating → happy | oops
 *   Connectivity               OfflineBanner: Nova 40px sleepy → waking → happy "back"; offline = oops
 *                              AsyncState: Nova 56px thinking (slow) / sleepy (stalled) / oops + line by Retry
 *   Empty lists                EmptyState `bot` prop: agent 72px stacked + 'empty…' line, button under it
 *                              PhoneDocs: Nova 80px over its own first-person line
 *   Slow list loads            SlowBot 40–48px above the skeleton, only past SLOW_MS
 *   Celebrations               celebrate/effects: 40px reactor in the caption slip (logic.reactorFor)
 *   Greetings                  Home/Today: NovaHello 44px (line) or NovaBeside 52–64px (brief already greets)
 *                              WaitingNova 40px beside the skeleton's SlowCaption
 *   First run                  FirstRun (desktop Home) and onboarding Ending: BotSays 56px 'firstRun';
 *                              PhoneOnboarding finale: Nova 72px wave
 *   Never                      on the quiz/review screens while the student is answering
 */
export { Bot, loadBotFace, type BotProps } from './Bot'
export { BotSays, type BotSaysProps } from './BotSays'
export { Reaction } from './Reaction'
export { BotProgress, formatElapsed, type BotProgressProps } from './BotProgress'
export { SlowBot } from './SlowBot'
export { useBotLine } from './useBotLine'
export { useArrivalMood, useBotMood, SITUATION_MOOD, type BotSituation, type BotMoodOptions } from './useBotMood'
export { AGENTS, AGENT_IDS, BOT_NAME, type AgentId, type AgentMeta } from './agents'
export { BOT_MOODS, POSES, type BotMood } from './moods'
