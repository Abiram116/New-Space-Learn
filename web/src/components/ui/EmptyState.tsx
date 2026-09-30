import type { ReactNode } from 'react'
import { BotSays } from '../mascot/BotSays'
import type { AgentId } from '../mascot/agents'
import type { BotMood } from '../mascot/moods'
import { useBotLine } from '../mascot/useBotLine'
import { useBotsShown } from '../../lib/botPreference'
import type { VoiceSituation } from '../../lib/botVoice'
import { cn } from '../../lib/cn'
import { type IconName } from './Icon'
import { Icon3D } from './Icon3D'

export type EmptyBot = {
  agent: AgentId
  /** Which of the agent's lines to say: 'emptyCards' | 'emptyQuizzes' | … */
  say: VoiceSituation
  /** `phone` picks the phone's wording (no chat there to promise). */
  surface?: 'phone'
  mood?: BotMood
}

/**
 * An empty binder slot. The dashed frame says "a card goes here", so the copy's
 * job is only to say which card and how to get it.
 *
 * With `bot`, the agent who owns the list stands in for the icon and says the
 * empty line itself; the title stays as the (visually hidden) heading so the
 * page outline is unchanged, and the description and action follow as usual —
 * the button, not the character, is still the thing to look at. With the bots
 * switched off in Settings it is the plain slot again, title and all.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  bot,
  className,
}: {
  icon: IconName
  title: string
  description?: string
  action?: ReactNode
  bot?: EmptyBot
  className?: string
}) {
  const botsOn = useBotsShown()
  const speaking = Boolean(bot && botsOn)
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-dash bg-well/40 px-6 text-center',
        speaking ? 'py-9' : 'py-14',
        className,
      )}
    >
      {speaking && bot ? (
        <>
          <EmptyBotSays bot={bot} />
          <h3 className="sr-only">{title}</h3>
          {description && <p className="max-w-sm text-[13.5px] leading-relaxed text-muted">{description}</p>}
        </>
      ) : (
        <>
          <span className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-line bg-raised text-brand">
            {/* The largest icon in the product, and the only thing on an empty
                screen — worth the depth. */}
            <Icon3D name={icon} size={20} lifted />
          </span>
          <div className="max-w-sm">
            <h3 className="nameplate text-[19px] text-ink">{title}</h3>
            {description && <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{description}</p>}
          </div>
        </>
      )}
      {action}
    </div>
  )
}

function EmptyBotSays({ bot }: { bot: EmptyBot }) {
  const line = useBotLine(bot.say, bot.agent, { surface: bot.surface })
  return (
    <BotSays agent={bot.agent} mood={bot.mood ?? 'idle'} layout="stacked" size={72} look>
      {line}
    </BotSays>
  )
}
