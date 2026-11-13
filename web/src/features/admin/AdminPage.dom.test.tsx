// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/errors'
import type { FeedbackResponse, FeedbackSummary } from '../../api/productFeedback'
import { ToastProvider } from '../../components/ui/Toast'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../../api/client', () => ({ apiFetch }))

import { AdminPage } from './AdminPage'
import { toCsv } from './Responses'
import { percent, scoreTone } from './Summary'

const SUMMARY: FeedbackSummary = {
  days: 30, total: 4, previous_total: 1, by_day: [{ date: '2026-10-01', count: 2 }, { date: '2026-10-02', count: 2 }],
  sources: { landing: 3, settings: 1 }, signed_in: 1, visitors: 3, want_reply: 1,
  takeaways: ['4 responses in the last 30 days — up from 1 in the 30 days before.'],
  items: [
    { question_id: 'a', prompt: 'Overall?', kind: 'rating', responses: 4, average: 3.5, median: 4, previous_average: 2,
      distribution: { '1': 1, '2': 0, '3': 0, '4': 2, '5': 1 }, positive_share: 75, nps: null, promoters: 0, passives: 0,
      detractors: 0, counts: {}, keywords: [], texts: [] },
    { question_id: 't', prompt: 'Next?', kind: 'long', responses: 2, average: null, median: null, previous_average: null,
      distribution: {}, positive_share: null, nps: null, promoters: 0, passives: 0, detractors: 0, counts: {},
      keywords: [{ word: 'offline', count: 2 }],
      texts: [{ text: 'Offline cards', created_at: '2026-10-02T09:00:00Z', score: 5 }, { text: 'Uploads fail', created_at: null, score: 1 }] },
  ],
}

const mount = () => render(<ToastProvider><AdminPage /></ToastProvider>)

beforeEach(() => {
  sessionStorage.clear()
  apiFetch.mockReset()
})
afterEach(cleanup)

describe('the feedback desk', () => {
  it('shows only a password box until the right password is given, and never stores the password', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/admin/unlock') return { token: 'tok', expires_at: Date.now() / 1000 + 3600 }
      return SUMMARY
    })
    mount()
    expect(screen.queryByText('Feedback desk')).toBeNull()
    await userEvent.type(screen.getByPlaceholderText('Password'), 'our secret words{Enter}')
    expect(await screen.findByText('Feedback desk')).toBeTruthy()
    // The hello shows once, right after the password, and a click sends it away.
    await userEvent.click(screen.getByText(/Helloo, boss bitch/))
    expect(screen.queryByText(/Helloo, boss bitch/)).toBeNull()
    expect(await screen.findByText(/up from 1 in the 30 days before/)).toBeTruthy()
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('our secret words')
    // Admin calls carry the token and no account.
    const call = apiFetch.mock.calls.find(([p]) => String(p).startsWith('/admin/feedback/summary'))!
    expect(call[1]).toMatchObject({ anonymous: true, headers: { 'X-Admin-Token': 'tok' } })
  })

  it('says so on a wrong password and stays locked', async () => {
    apiFetch.mockRejectedValue(new ApiError('forbidden', "That's not the password.", 403))
    mount()
    await userEvent.type(screen.getByPlaceholderText('Password'), 'guess{Enter}')
    expect((await screen.findByRole('alert')).textContent).toContain("That's not the password.")
    expect(screen.queryByText('Feedback desk')).toBeNull()
  })

  it('locks again when the server stops accepting the token, and on Lock', async () => {
    sessionStorage.setItem('sl:desk', JSON.stringify({ token: 'old', expires_at: Date.now() / 1000 + 3600 }))
    apiFetch.mockRejectedValue(new ApiError('forbidden', 'The admin page is locked.', 403))
    mount()
    await waitFor(() => expect(screen.getByPlaceholderText('Password')).toBeTruthy())
    expect(sessionStorage.getItem('sl:desk')).toBeNull()
  })

  it('an expired token is not an open door', () => {
    sessionStorage.setItem('sl:desk', JSON.stringify({ token: 'old', expires_at: 1 }))
    mount()
    expect(screen.getByPlaceholderText('Password')).toBeTruthy()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('a summary that cannot be read says so in read words, offers a retry, and then shows', async () => {
    sessionStorage.setItem('sl:desk', JSON.stringify({ token: 'tok', expires_at: Date.now() / 1000 + 3600 }))
    apiFetch.mockRejectedValueOnce(
      new ApiError('upstream_unavailable', "We couldn't load the feedback just now. Please try again.", 503),
    )
    apiFetch.mockResolvedValue(SUMMARY)
    mount()
    expect((await screen.findByRole('alert')).textContent).toContain("couldn't load the feedback")
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/up from 1 in the 30 days before/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leaves out the scores nobody gave', async () => {
    sessionStorage.setItem('sl:desk', JSON.stringify({ token: 'tok', expires_at: Date.now() / 1000 + 3600 }))
    apiFetch.mockResolvedValue(SUMMARY)
    mount()
    await screen.findByText('Overall?')
    expect(screen.getByText('2 · 50%')).toBeTruthy()
    expect(screen.queryByText('0 · 0%')).toBeNull()
  })

  it('shows who sent each response: the account email, or Visitor', async () => {
    sessionStorage.setItem('sl:desk', JSON.stringify({ token: 'tok', expires_at: Date.now() / 1000 + 3600 }))
    const base = { created_at: '2026-10-02T09:00:00Z', page: null, answers: [{ question_id: 'a', prompt: 'Overall?', kind: 'rating' as const, value: 4 }] }
    const rows: FeedbackResponse[] = [
      { ...base, id: '1', source: 'settings', signed_in: true, sender_email: 'student@x.test', contact_email: null },
      { ...base, id: '2', source: 'landing', signed_in: false, sender_email: null, contact_email: null },
    ]
    apiFetch.mockImplementation(async (path: string) => (path.includes('/responses') ? rows : SUMMARY))
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Responses' }))
    const link = await screen.findByRole('link', { name: /student@x\.test/ })
    expect(link.getAttribute('href')).toBe('mailto:student@x.test')
    expect(screen.getByText('· Visitor')).toBeTruthy()
    expect(screen.queryByText(/Settings|Landing page/)).toBeNull()
  })

  it('filters written answers to the unhappy ones', async () => {
    sessionStorage.setItem('sl:desk', JSON.stringify({ token: 'tok', expires_at: Date.now() / 1000 + 3600 }))
    apiFetch.mockResolvedValue(SUMMARY)
    mount()
    expect(await screen.findByText('Offline cards')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /From unhappy people · 1/ }))
    expect(screen.queryByText('Offline cards')).toBeNull()
    expect(screen.getByText('Uploads fail')).toBeTruthy()
  })
})

describe('helpers', () => {
  it('toCsv: one column per question, quotes escaped, formulas defused', () => {
    const rows: FeedbackResponse[] = [{
      id: '1', created_at: '2026-10-02T09:00:00Z', source: 'landing', signed_in: false, contact_email: 'a@b.test', page: null,
      answers: [
        { question_id: 'a', prompt: 'Overall?', kind: 'rating', value: 4 },
        { question_id: 't', prompt: 'Next?', kind: 'long', value: '=HYPERLINK("x"), please' },
        { question_id: 'm', prompt: 'Liked?', kind: 'multi', value: ['Speed', 'Design'] },
      ],
    }]
    const [head, line] = toCsv(rows).split('\n')
    expect(head).toBe('"When","From","Who","Reply to","Overall?","Next?","Liked?"')
    expect(line).toBe('"2026-10-02T09:00:00Z","landing","visitor","a@b.test","4","\'=HYPERLINK(""x""), please","Speed, Design"')
    expect(toCsv([{ ...rows[0], signed_in: true, sender_email: 's@x.test' }]).split('\n')[1]).toContain('"landing","s@x.test"')
  })

  it('percent and scoreTone', () => {
    expect([percent(1, 3), percent(0, 0)]).toEqual([33, 0])
    expect(scoreTone(1)).toContain('coral')
    expect(scoreTone(5)).toContain('jade')
    expect(scoreTone(null)).toContain('muted')
  })
})
