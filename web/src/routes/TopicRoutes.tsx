/**
 * Route elements that differ between phone and desktop.
 *
 * Phones have no chat (see `features/mobile`). Every chat-shaped address is
 * decided HERE, at the route, so no screen has to remember to hide itself:
 *
 *   /s/:space/:sub          desktop: chat            phone: TopicHub
 *   /s/:space/:sub/chat     desktop: → /s/:space/:sub phone: ChatOnDesktop
 *   /s/:space/:sub/skills   desktop: Skills          phone: ChatOnDesktop (skills)
 *   /flashcards|quizzes|notes  both: → that list inside the current topic
 *
 * `useIsMobile` is the one rule for "phone"; nothing here invents another.
 */

import { useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { PageSpinner } from '../components/ui/PageSpinner'
import { useCurrentTopic } from '../features/mobile/currentTopic'
import { NewSpaceModal } from '../features/spaces/NewSpaceModal'
import { useIsMobile } from '../lib/useIsMobile'
import { ChatOnDesktop, ChatView, Lazy, SkillsView, TopicHub } from './lazyRoutes'

export function TopicIndexRoute() {
  const mobile = useIsMobile()
  return <Lazy>{mobile ? <TopicHub /> : <ChatView />}</Lazy>
}

/** An explicit chat address — handy to share, and what a phone explains. */
export function ChatAliasRoute() {
  const mobile = useIsMobile()
  const { spaceId, subspaceId } = useParams()
  if (!mobile) return <Navigate to={`/s/${spaceId}/${subspaceId}`} replace />
  return (
    <Lazy>
      <ChatOnDesktop />
    </Lazy>
  )
}

export function SkillsRoute() {
  const mobile = useIsMobile()
  return <Lazy>{mobile ? <ChatOnDesktop feature="skills" /> : <SkillsView />}</Lazy>
}

/**
 * `/flashcards`, `/quizzes`, `/notes` — the account-wide lists without a
 * topic in the URL (the phone's tabs, a bookmark). The screens themselves
 * live under a topic, because a topic still decides where something NEW is
 * created, so this forwards to the current one, keeping any `?deck=`-style
 * query. With no topic anywhere yet, it says so and offers the fix.
 */
export function AccountWideRoute({ section }: { section: 'flashcards' | 'quizzes' | 'notes' }) {
  const { base, loading } = useCurrentTopic()
  const { search } = useLocation()
  const [newOpen, setNewOpen] = useState(false)

  if (base) return <Navigate to={`${base}/${section}${search}`} replace />
  if (loading) return <PageSpinner />

  const what = section === 'flashcards' ? 'cards' : section
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <EmptyState
        icon={section === 'flashcards' ? 'deck' : section === 'quizzes' ? 'quiz' : 'note'}
        title="Start with a subject"
        description={`Your ${what} are made from the material in a topic. Add a subject and a first topic, then bring in a PDF or some notes.`}
        action={<Button onClick={() => setNewOpen(true)}>New subject</Button>}
      />
      <NewSpaceModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
