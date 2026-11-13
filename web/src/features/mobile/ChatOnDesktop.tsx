/**
 * What a phone shows for a chat-only address.
 *
 * Phones are the revision half of Space Learn: chat (and Skills, which only
 * change how chat answers) live on the big screen, where sources, citations
 * and the answer fit side by side. Someone who lands here from a shared or
 * old link gets a straight explanation, a one-tap way to get the link onto
 * their laptop, and the three things they *can* do with this topic now.
 */

import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { useCurrentTopic } from './currentTopic'
import { MobileRow, RowGroup } from './MobileRow'
import { shareOrCopy } from './shareLink'

export function ChatOnDesktop({ feature = 'chat' }: { feature?: 'chat' | 'skills' }) {
  const { subspace, base } = useCurrentTopic()
  const { pathname } = useLocation()
  const { show } = useToast()
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)

  // The desktop address for the same thing: the topic root is its chat.
  const deskPath = feature === 'skills' ? pathname : pathname.replace(/\/chat\/?$/, '')
  const url = `${window.location.origin}${deskPath}`
  const topicName = subspace?.name

  const send = async () => {
    const outcome = await shareOrCopy({
      title: topicName ? `Space Learn — ${topicName}` : 'Space Learn',
      url,
    })
    if (outcome === 'copied') show('Link copied! Paste it where you can open it on your computer.', 'success')
    if (outcome === 'failed') {
      setFallbackUrl(url)
      show("We couldn't copy the link. It's below, so you can copy it yourself.", 'error')
    }
  }

  const heading = feature === 'skills' ? 'Skills live with chat' : 'Chat is on the big screen'
  const body =
    feature === 'skills'
      ? 'Skills change how the AI answers you in chat, so you set them up on a computer. Your phone is for revising.'
      : 'Asking questions about your files needs room to read the answer and its pages, so it works best on a computer. Your phone is for revising.'

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-10 pt-8">
        <span className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-azure-soft text-azure-deep" aria-hidden>
          <Icon name={feature === 'skills' ? 'skill' : 'chat'} size={26} />
        </span>
        <h2 className="nameplate mt-5 text-[28px] leading-[0.98] text-ink [text-wrap:balance]">{heading}</h2>
        <p className="mt-3 text-[16px] leading-relaxed text-muted">{body}</p>

        <Button size="xl" className="mt-6 w-full" onClick={() => void send()}>
          <Icon name="send" size={18} /> Send myself the link
        </Button>
        {fallbackUrl && (
          <input
            readOnly
            value={fallbackUrl}
            aria-label="Link to open on your laptop"
            onFocus={(e) => e.currentTarget.select()}
            className="mt-3 min-h-11 w-full rounded-[11px] border border-line bg-well px-3 font-mono text-[13px] text-ink-2"
          />
        )}

        {base && (
          <>
            <h3 className="setcode-strong mt-10 px-1 pb-2.5">
              {topicName ? `Revise ${topicName} here` : 'Revise here'}
            </h3>
            <RowGroup label="Revise this topic">
              <MobileRow to={`${base}/flashcards`} icon="deck" role="recall" label="Cards" />
              <MobileRow to={`${base}/quizzes`} icon="quiz" role="test" label="Quizzes" />
              <MobileRow to={`${base}/notes`} icon="note" role="read" label="Notes" />
            </RowGroup>
          </>
        )}
      </div>
    </div>
  )
}
