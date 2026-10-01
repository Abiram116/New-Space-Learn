/**
 * Route elements that differ between phone and desktop.
 *
 * Phones have no chat (see `features/mobile`). Every chat-shaped address is
 * decided HERE, at the route, so no screen has to remember to hide itself:
 *
 *   /:space/:sub          desktop: chat            phone: TopicHub
 *   /:space/:sub/chat     desktop: → /:space/:sub phone: ChatOnDesktop
 *   /skills                 desktop: Skills          phone: ChatOnDesktop (skills)
 *   /:space/:sub/skills   → /skills (the library is account-wide; see TopicSkillsRedirect)
 *   /flashcards|quizzes|notes  both: the account-wide list (see lib/useTopicScope)
 *
 * `useIsMobile` is the one rule for "phone"; nothing here invents another.
 */

import { Navigate, useParams } from 'react-router-dom'
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
  if (!mobile) return <Navigate to={`/${spaceId}/${subspaceId}`} replace />
  return (
    <Lazy>
      <ChatOnDesktop />
    </Lazy>
  )
}

/**
 * Skills are one library for the whole account, switched on per topic, so they
 * live at `/skills`. A topic's own `…/skills` address (old bookmarks, anything
 * still pointing at it) forwards there.
 */
export function TopicSkillsRedirect() {
  return <Navigate to="/skills" replace />
}

export function SkillsRoute() {
  const mobile = useIsMobile()
  return <Lazy>{mobile ? <ChatOnDesktop feature="skills" /> : <SkillsView />}</Lazy>
}
