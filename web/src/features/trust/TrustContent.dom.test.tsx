// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEAM, TEAM_EMAILS } from './config'
import { TrustCard } from './TrustCard'

afterEach(cleanup)

const open = (slug: 'about' | 'contact' | 'privacy') =>
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
})
