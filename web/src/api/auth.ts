/**
 * Auth helpers wrapped around supabase-js so views never call it directly.
 * Every returned promise resolves to something the UI can render — errors
 * bubble as `ApiError` so the shared error handler covers them.
 */

import type { AuthChangeEvent, Session } from '@supabase/auth-js'
import { ApiError, isReadable } from './errors'
import { getSupabase } from './supabase'

export type { Session }

export async function getSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession()
  if (error) throw new ApiError('unauthorized', error.message || 'Sign in required.')
  return data.session
}

export function onAuthChange(cb: (event: AuthChangeEvent, session: Session | null) => void) {
  return getSupabase().auth.onAuthStateChange(cb)
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password })
  if (error) throw fromSupabaseError(error)
  if (!data.session) throw new ApiError('unauthorized', 'Sign-in failed.')
  return data.session
}

export async function signUpWithPassword(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ session: Session | null; requiresConfirmation: boolean }> {
  const { data, error } = await getSupabase().auth.signUp({
    email,
    password,
    options: {
      data: displayName ? { display_name: displayName } : undefined,
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) throw fromSupabaseError(error)
  // With email confirmation on, Supabase answers a sign-up for an address that
  // already has an account with SUCCESS and an empty `identities` list — to avoid
  // revealing which emails exist — and sends no email at all. Treated as success,
  // the screen says "we sent a confirmation link" and nothing ever arrives,
  // which reads exactly like "the emails are broken". A person signing up with
  // an address they used before is told so.
  if (!data.session && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new ApiError('validation_error', 'An account with that email already exists. Sign in instead.')
  }
  return { session: data.session, requiresConfirmation: !data.session }
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) throw fromSupabaseError(error)
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/callback?reset=1`,
  })
  if (error) throw fromSupabaseError(error)
}

export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) throw fromSupabaseError(error)
}

/**
 * Change the name shown in the rail, on Profile and in the Home brief.
 *
 * Stored in Supabase's `user_metadata` rather than a table of our own: it
 * already travels with the session, so every screen that reads
 * `user.user_metadata.display_name` picks it up without a fetch, and there
 * is no second source of truth to keep in step.
 */
export async function updateDisplayName(name: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({
    data: { display_name: name },
  })
  if (error) throw fromSupabaseError(error)
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut()
  if (error) throw new ApiError('internal_error', error.message)
}

/**
 * Ask Supabase to trade the refresh token for a new access token.
 *
 * Used to tell two very different 401s apart: an access token that simply
 * aged out mid-request (refresh succeeds, carry on) versus a session the
 * server will never honour again — deleted account, revoked token — where the
 * refresh is rejected too. Returns null instead of throwing, because every
 * caller wants "did this work" rather than an exception to catch.
 */
export async function refreshSession(): Promise<Session | null> {
  try {
    const { data, error } = await getSupabase().auth.refreshSession()
    if (error) return null
    return data.session ?? null
  } catch {
    return null
  }
}

/**
 * Drop the session on this device without asking the server to revoke it.
 *
 * For the case where the server-side user is already gone — a deleted account,
 * a session revoked elsewhere. A normal `signOut()` posts to `/logout` with the
 * dead token, gets a 401, throws, and leaves the local session sitting in
 * storage: the app still believes it is signed in, `RedirectIfAuthed` bounces
 * `/signin` back to `/home`, and every request from then on 401s. Clearing
 * locally is the only step that actually applies when there is nothing left to
 * revoke.
 */
export async function signOutLocally(): Promise<void> {
  // Never throws: this runs on paths whose whole purpose is to get someone
  // *out*, and failing there would strand them in the broken state.
  try {
    await getSupabase().auth.signOut({ scope: 'local' })
  } catch {
    /* the session is being abandoned either way */
  }
}

/** Turn supabase-js text errors into our typed error so UX is consistent. */
function fromSupabaseError(error: { message: string; status?: number }): ApiError {
  const { message } = error
  // A server-side failure — most often "couldn't send the email" — comes back as
  // a bare 5xx whose body supabase-js never reads, so its message is the literal
  // text `{}` (it stringifies the Response object). Nobody should read that.
  if ((error.status ?? 0) >= 500 || message.trim() === '{}') {
    return new ApiError(
      'upstream_unavailable',
      "We couldn't send the email just now. Please try again in a few minutes.",
      error.status ?? 0,
    )
  }
  const lower = message.toLowerCase()
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return new ApiError('validation_error', 'Email or password is incorrect.')
  }
  if (lower.includes('email not confirmed')) {
    return new ApiError('validation_error', 'Confirm your email before signing in.')
  }
  if (lower.includes('user already registered')) {
    return new ApiError('validation_error', 'An account with that email already exists.')
  }
  if (
    lower.includes('over_email_send_rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('for security purposes') ||
    lower.includes('too many requests')
  ) {
    return new ApiError('rate_limited', 'Too many attempts. Wait a minute and try again.')
  }
  if (lower.includes('invalid or has expired') || lower.includes('token has expired') || lower.includes('otp_expired')) {
    return new ApiError('validation_error', 'That link has expired. Request a new one and try again.')
  }
  if (lower.includes('signups not allowed') || lower.includes('signup is disabled')) {
    return new ApiError('validation_error', 'Sign-ups are closed right now.')
  }
  if (lower.includes('unable to validate email') || lower.includes('invalid format')) {
    return new ApiError('validation_error', "That email address doesn't look right.")
  }
  if (lower.includes('different from the old password') || lower.includes('same as the old')) {
    return new ApiError('validation_error', 'Choose a password you have not used before.')
  }
  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return new ApiError('network', "Can't reach the server. Check your connection and try again.")
  }
  // Anything else is shown only if it reads like a sentence for a person
  // ("Password should be at least 8 characters."); otherwise a plain default.
  if (isReadable(message)) return new ApiError('validation_error', message)
  return new ApiError('validation_error', 'Something went wrong. Please check what you entered and try again.')
}

