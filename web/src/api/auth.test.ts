// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './errors'

const signUp = vi.fn()
vi.mock('./supabase', () => ({ getSupabase: () => ({ auth: { signUp } }) }))

import { signUpWithPassword } from './auth'

beforeEach(() => signUp.mockReset())

describe('signUpWithPassword', () => {
  it('asks for confirmation when a new account has no session yet', async () => {
    signUp.mockResolvedValue({
      data: { session: null, user: { id: 'u1', identities: [{ id: 'i1' }] } },
      error: null,
    })
    await expect(signUpWithPassword('a@b.co', 'password1', 'Ada')).resolves.toEqual({
      session: null,
      requiresConfirmation: true,
    })
  })

  it('signs straight in when confirmation is off', async () => {
    const session = { access_token: 't' }
    signUp.mockResolvedValue({ data: { session, user: { id: 'u1', identities: [{ id: 'i1' }] } }, error: null })
    const out = await signUpWithPassword('a@b.co', 'password1')
    expect(out.requiresConfirmation).toBe(false)
    expect(out.session).toBe(session)
  })

  it('says so when the address already has an account, instead of promising an email that never comes', async () => {
    // Supabase's anti-enumeration answer: success, no session, an empty identities list.
    signUp.mockResolvedValue({ data: { session: null, user: { id: 'u1', identities: [] } }, error: null })
    const err = await signUpWithPassword('a@b.co', 'password1').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toMatch(/already exists/i)
  })

  it('turns a bare server error (what a failed confirmation email looks like) into plain words, not `{}`', async () => {
    signUp.mockResolvedValue({ data: { session: null, user: null }, error: { message: '{}', status: 500 } })
    const err = await signUpWithPassword('a@b.co', 'password1').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('upstream_unavailable')
    expect(err.message).toMatch(/couldn.t send the email/i)
    expect(err.message).not.toContain('{}')
  })

  it.each([
    ['For security purposes, you can only request this after 52 seconds.', 'rate_limited', /wait a minute/i],
    ['Email link is invalid or has expired', 'validation_error', /link has expired/i],
    ['Signups not allowed for this instance', 'validation_error', /closed/i],
    ['Unable to validate email address: invalid format', 'validation_error', /doesn.t look right/i],
    ['Failed to fetch', 'network', /can.t reach the server/i],
    ['[object Object]', 'validation_error', /Something went wrong/],
    ['Password should be at least 8 characters.', 'validation_error', /at least 8 characters/],
  ])('says %j in plain words', async (text, code, expected) => {
    signUp.mockResolvedValue({ data: { session: null, user: null }, error: { message: text, status: 400 } })
    const err = await signUpWithPassword('a@b.co', 'password1').catch((e) => e)
    expect(err.code).toBe(code)
    expect(err.message).toMatch(expected)
  })

  it('still reports a real error from Supabase', async () => {
    signUp.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'over_email_send_rate_limit' } })
    const err = await signUpWithPassword('a@b.co', 'password1').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('rate_limited')
  })
})
