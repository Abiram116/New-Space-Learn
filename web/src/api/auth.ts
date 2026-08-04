/**
 * Auth helpers wrapped around supabase-js so views never call it directly.
 * Every returned promise resolves to something the UI can render — errors
 * bubble as `ApiError` so the shared error handler covers them.
 */

import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { ApiError } from './errors'
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
  if (error) throw fromSupabaseError(error.message)
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
  if (error) throw fromSupabaseError(error.message)
  return { session: data.session, requiresConfirmation: !data.session }
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) throw fromSupabaseError(error.message)
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/callback?reset=1`,
  })
  if (error) throw fromSupabaseError(error.message)
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut()
  if (error) throw new ApiError('internal_error', error.message)
}

/** Turn supabase-js text errors into our typed error so UX is consistent. */
function fromSupabaseError(message: string): ApiError {
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
  if (lower.includes('over_email_send_rate_limit') || lower.includes('rate limit')) {
    return new ApiError('rate_limited', 'Too many attempts. Wait a minute and try again.')
  }
  return new ApiError('validation_error', message)
}
