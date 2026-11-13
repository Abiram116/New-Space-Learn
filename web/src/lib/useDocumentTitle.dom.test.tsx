// @vitest-environment jsdom
/**
 * Each page names its browser tab; the landing page keeps the title that
 * `index.html` (and so every crawler and link preview) carries.
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ADMIN_PATH } from './env'
import { RESERVED_ROOTS } from './slug'
import { SITE_TITLE, pageTitle, titleForPath, topicSectionTitle, useDocumentTitle } from './useDocumentTitle'

afterEach(cleanup)

describe('titleForPath', () => {
  it('names the fixed pages', () => {
    expect(titleForPath('/signin')).toBe('Sign in')
    expect(titleForPath('/signup')).toBe('Sign up')
    expect(titleForPath('/notes')).toBe('Notes')
    expect(titleForPath('/flashcards')).toBe('Cards')
    expect(titleForPath('/home/')).toBe('Home')
    expect(titleForPath('/auth/reset-password')).toBe('Reset password')
  })

  it('keeps the site title for the landing page, the trust pages and the hidden desk', () => {
    for (const path of ['/', '/welcome', '/privacy', '/about', `/${ADMIN_PATH}`]) {
      expect(titleForPath(path)).toBeNull()
    }
  })

  it('leaves a topic address to the code that knows the topic', () => {
    expect(titleForPath('/biology/cells')).toBeUndefined()
    expect(titleForPath('/biology/cells/notes')).toBeUndefined()
    expect(titleForPath('/s/sp1/tp1/quizzes')).toBeUndefined()
  })

  it('calls anything else what it is', () => {
    expect(titleForPath('/nowhere')).toBe('Page not found')
    expect(titleForPath('/biology/cells/nonsense')).toBe('Page not found')
    expect(titleForPath('/a/b/c/d')).toBe('Page not found')
  })

  it('has an answer for every one-word address the app reserves for a page', () => {
    // A page added to the router but not here would be titled "Page not found".
    const notPages = new Set(['s', 'api', 'assets', 'auth', 'help', 'sitemap.xml', 'robots.txt', 'favicon.svg', 'icons.svg'])
    for (const root of RESERVED_ROOTS) {
      if (notPages.has(root)) continue
      expect(titleForPath(`/${root}`), root).not.toBe('Page not found')
    }
  })
})

describe('topicSectionTitle', () => {
  it('names the section, and nothing for the topic itself or its chat', () => {
    expect(topicSectionTitle('/biology/cells')).toBeNull()
    expect(topicSectionTitle('/biology/cells/chat')).toBeNull()
    expect(topicSectionTitle('/biology/cells/docs')).toBe('Sources')
    expect(topicSectionTitle('/s/sp1/tp1/flashcards')).toBe('Cards')
  })
})

describe('useDocumentTitle', () => {
  function Page({ title }: { title: string | null | undefined }) {
    useDocumentTitle(title)
    return null
  }

  it('sets, changes, restores and leaves alone', () => {
    const { rerender } = render(<Page title="Notes" />)
    expect(document.title).toBe('Notes · Space Learn')
    rerender(<Page title="Cells" />)
    expect(document.title).toBe('Cells · Space Learn')
    rerender(<Page title={undefined} />)
    expect(document.title).toBe('Cells · Space Learn')
    rerender(<Page title={null} />)
    expect(document.title).toBe(SITE_TITLE)
  })

  it('keeps the title index.html carries, and puts the page first', () => {
    expect(SITE_TITLE).toBe('Space Learn')
    expect(pageTitle('Sign in')).toBe('Sign in · Space Learn')
  })
})
