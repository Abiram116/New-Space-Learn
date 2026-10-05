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
import { percent, scoreTone } from './format'

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

const DASH = {
  generated_at: '2026-10-10T12:00:00Z',
  users: {
    total: 120, new_7d: 9, new_30d: 31, active_1d: 14, active_7d: 40, active_30d: 77,
    daily: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, count: i % 5 })),
  },
  usage: {
    messages: { total: 5400, this_week: 300, last_week: 250 },
    files: { total: 210, this_week: 12, last_week: 12 },
    notes: { total: 88, this_week: 4, last_week: 9 },
    cards: { total: 1500, this_week: null, last_week: null },
    quizzes: { total: 66, this_week: 5, last_week: 1 },
    reviews: { total: 9000, this_week: 700, last_week: 650 },
  },
  funnel: {
    steps: [
      { label: 'Signed up', count: 120, percent: 100 },
      { label: 'Uploaded a file', count: 90, percent: 75 },
      { label: 'Asked a question', count: 80, percent: 67 },
      { label: 'Made cards or a quiz', count: 50, percent: 42 },
      { label: 'Came back another day', count: 30, percent: 25 },
    ],
    approximate: false,
  },
}
const FEEDBACK = { ...SUMMARY, total: 4, items: [{ ...SUMMARY.items[0], kind: 'choice', counts: { Notes: 3, Quizzes: 1 }, distribution: {} }] }

const route = (path: string) => {
  if (path === '/admin/unlock') return { token: 'tok', expires_at: Date.now() / 1000 + 3600 }
  if (path === '/admin/dashboard') return DASH
  if (path.startsWith('/admin/feedback/summary')) return FEEDBACK
  if (path.startsWith('/admin/feedback/responses')) return [RESPONSE]
  return []
}
const RESPONSE: FeedbackResponse = {
  id: '1', created_at: '2026-10-02T09:00:00Z', source: 'landing', signed_in: false, contact_email: null, page: null,
  answers: [{ question_id: 'a', prompt: 'Use it for?', kind: 'choice', value: 'Notes', detail: 'Exam revision notes' }],
}
const mount = () => render(<ToastProvider><AdminPage /></ToastProvider>)

beforeEach(() => {
  sessionStorage.clear()
  apiFetch.mockReset()
  apiFetch.mockImplementation(async (path: string) => route(path))
})
afterEach(cleanup)

describe('the admin page', () => {
  it('shows only a password box until the right password is given, never stores it, then greets and shows the numbers', async () => {
    mount()
    expect(screen.queryByText('Admin')).toBeNull()
    await userEvent.type(screen.getByPlaceholderText('Password'), 'our secret words{Enter}')
    expect(await screen.findByText('Hello Boss')).toBeTruthy()
    expect(await screen.findByText('120')).toBeTruthy() // signed up
    expect(screen.getByText('5,400')).toBeTruthy() // questions asked
    expect(screen.getByText('Came back another day')).toBeTruthy()
    expect(await screen.findByText('Exam revision notes', { exact: false })).toBeTruthy() // written reply
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('our secret words')
    const call = apiFetch.mock.calls.find(([p]) => p === '/admin/dashboard')!
    expect(call[1]).toMatchObject({ anonymous: true, headers: { 'X-Admin-Token': 'tok' } })
  })

  it('fetches once on open and again only when Refresh is pressed', async () => {
    sessionStorage.setItem('sl:desk', JSON.stringify({ token: 'tok', expires_at: Date.now() / 1000 + 3600 }))
    mount()
    await screen.findByText('120')
    const dash = () => apiFetch.mock.calls.filter(([p]) => p === '/admin/dashboard').length
    expect(dash()).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    await waitFor(() => expect(dash()).toBe(2))
  })

  it('says so on a wrong password and stays locked', async () => {
    apiFetch.mockReset()
    apiFetch.mockRejectedValue(new ApiError('forbidden', "That's not the password.", 403))
    mount()
    await userEvent.type(screen.getByPlaceholderText('Password'), 'guess{Enter}')
    expect((await screen.findByRole('alert')).textContent).toContain("That's not the password.")
    expect(screen.queryByText('Admin')).toBeNull()
  })

  it('locks again when the server stops accepting the token', async () => {
    sessionStorage.setItem('sl:desk', JSON.stringify({ token: 'old', expires_at: Date.now() / 1000 + 3600 }))
    apiFetch.mockReset()
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
  })

  it('percent and scoreTone', () => {
    expect([percent(1, 3), percent(0, 0)]).toEqual([33, 0])
    expect(scoreTone(1)).toContain('coral')
    expect(scoreTone(5)).toContain('jade')
    expect(scoreTone(null)).toContain('muted')
  })
})
