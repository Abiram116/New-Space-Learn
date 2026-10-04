/**
 * Coming back from a full page to the chat sidebar you left.
 *
 * Quizzes and card reviews open as full pages. Opened from the global lists,
 * Back goes to the list. Opened from a topic's chat sidebar, Back should go to
 * that chat, with the sidebar panel you left open — a different place, so the
 * page has to know which one it was opened from.
 *
 * The mark is `?from=chat` in the address: unlike router state it survives the
 * page rewriting its own query (`?q=` becomes a readable name), a reload, and a
 * shared link that opens the page directly (where it simply has no chat to go
 * back to and falls back to the list).
 */

import type { NavigateFunction } from 'react-router-dom'

/** Which sidebar panel to reopen when returning to the chat. */
export type ChatReturnState = { dockPanel: 'quizzes' | 'flashcards' | 'docs' | 'notes' }

export function cameFromChat(params: URLSearchParams): boolean {
  return params.get('from') === 'chat'
}

/** `href` with the mark added, for links that start in the chat. */
export function fromChatHref(href: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}from=chat`
}

/** Back to the topic's chat, with the panel the person left open. */
export function returnToChat(navigate: NavigateFunction, base: string, dockPanel: ChatReturnState['dockPanel']): void {
  // `replace`: the page you are leaving shouldn't sit in history between the chat and the chat.
  navigate(base || '/home', { state: { dockPanel } satisfies ChatReturnState, replace: true })
}

/** The full page for one quiz, opened from the chat sidebar. */
export const quizHref = (base: string, quizId: string): string => fromChatHref(`${base}/quizzes?q=${quizId}`)

/** The full-page review of one deck, opened from the chat sidebar. */
export const reviewDeckHref = (base: string, deckId: string): string =>
  fromChatHref(`${base}/flashcards?deck=${deckId}&review=deck`)

/** One deck's page (its cards), opened from the chat sidebar. */
export const deckHref = (base: string, deckId: string): string => fromChatHref(`${base}/flashcards?deck=${deckId}`)
