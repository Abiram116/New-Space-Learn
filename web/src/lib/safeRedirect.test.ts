// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isSafeExternalHref, safeNext } from './safeRedirect'

describe('safeNext', () => {
  it.each([
    ['/home', '/home'],
    ['/s/abc/docs?d=1#p2', '/s/abc/docs?d=1#p2'],
    ['/quizzes', '/quizzes'],
  ])('keeps an in-app path %s', (raw, want) => {
    expect(safeNext(raw)).toBe(want)
  })

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    ' //evil.example',
    '/\t/evil.example',
    'evil.example',
    '',
    null,
  ])('refuses %s', (raw) => {
    expect(safeNext(raw as string | null)).toBe('/home')
  })
})

describe('isSafeExternalHref', () => {
  it('allows web and mail links', () => {
    expect(isSafeExternalHref('https://example.com/a')).toBe(true)
    expect(isSafeExternalHref('mailto:a@b.c')).toBe(true)
  })
  it('refuses script and data links', () => {
    expect(isSafeExternalHref('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalHref(' JavaScript:alert(1)')).toBe(false)
    expect(isSafeExternalHref('data:text/html,<script>alert(1)</script>')).toBe(false)
  })
})
