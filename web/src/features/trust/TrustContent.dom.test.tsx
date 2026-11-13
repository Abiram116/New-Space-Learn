// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEAM, TEAM_EMAILS } from './config'
import { TrustCard } from './TrustCard'

afterEach(cleanup)

const open = (slug: 'about' | 'contact' | 'privacy' | 'terms') =>
  render(
    <MemoryRouter>
      <TrustCard slug={slug} motion="enter" onClose={() => {}} />
    </MemoryRouter>,
  )

describe('trust page content', () => {
  it('About: the two of us, by name only, in the column beside the page (Built by)', () => {
    open('about')
    const aside = screen.getByRole('complementary', { name: 'Built by' })
    for (const p of TEAM) expect(within(aside).getByText(p.name)).toBeInTheDocument()
    expect(TEAM).toHaveLength(2)
  })

  it('Contact: each person with their own email — write, or copy it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    open('contact')
    for (const p of TEAM) {
      expect(screen.getByText(p.email)).toBeInTheDocument()
    }
    const writes = screen.getAllByRole('link', { name: 'Write' })
    expect(writes.map((a) => a.getAttribute('href'))).toEqual(TEAM.map((p) => `mailto:${p.email}`))
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0])
    expect(writeText).toHaveBeenCalledWith(TEAM[0].email)
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('"write to either of us" addresses both of us', () => {
    open('privacy')
    const links = screen.getAllByRole('link', { name: 'either of us' })
    expect(links[0]).toHaveAttribute('href', `mailto:${TEAM_EMAILS}`)
  })

  it('every page leads with the short version', () => {
    for (const slug of ['about', 'privacy', 'terms', 'contact'] as const) {
      open(slug)
      expect(screen.getByText('The short version')).toBeInTheDocument()
      cleanup()
    }
  })

  it('Privacy: the key facts up top — what is stored, who sees it, how to delete it, who to ask', () => {
    open('privacy')
    const glance = screen.getByRole('region', { name: 'At a glance' })
    for (const label of ['What we store', 'Who can see it', 'How to delete it', 'Questions or a copy']) {
      expect(within(glance).getByText(label)).toBeInTheDocument()
    }
  })

  it('long pages list their sections, in order, and a jump moves focus to the section', () => {
    open('privacy')
    const navs = screen.getAllByRole('navigation', { name: 'On this page' })
    const links = within(navs[0]).getAllByRole('link')
    const headings = screen.getAllByRole('heading', { level: 3 }).filter((h) => h.id.endsWith('-h'))
    expect(links.map((a) => a.textContent?.replace(/^\d\d/, ''))).toEqual(headings.map((h) => h.textContent?.replace(/^\d\d/, '')))
    fireEvent.click(links[3])
    expect(document.activeElement).toBe(headings[3])
  })

  it('short pages have no jump list', () => {
    open('contact')
    expect(screen.queryByRole('navigation', { name: 'On this page' })).toBeNull()
  })
})
