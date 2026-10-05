/**
 * The site's security headers (vercel.json) and the things that would make the
 * Content-Security-Policy break the app instead of protecting it.
 *
 * The policy allows scripts from this origin only. An inline `<script>` added
 * to index.html, or a new origin the app starts talking to, would be blocked in
 * production while every local run kept working — so both are checked here.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}
// Comments removed: they talk about Google Fonts and scripts without loading either.
const html = readFileSync(resolve(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')

const siteWide = vercel.headers.find((h) => h.source === '/(.*)')?.headers ?? []
const header = (key: string) => siteWide.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value
const csp = header('Content-Security-Policy') ?? ''
const directive = (name: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `))
    ?.split(/\s+/)
    .slice(1) ?? []

describe('security headers', () => {
  it('sends the hardening headers on every page', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('X-Frame-Options')).toBe('DENY')
    expect(header('Strict-Transport-Security')).toMatch(/max-age=\d{8,}/)
    expect(header('Referrer-Policy')).toBeTruthy()
    expect(csp).toBeTruthy()
  })

  it('runs only this origin’s scripts', () => {
    const scripts = directive('script-src')
    expect(scripts).toEqual(["'self'"])
    expect(csp).not.toMatch(/unsafe-eval/)
    expect(directive('object-src')).toEqual(["'none'"])
    expect(directive('frame-ancestors')).toEqual(["'none'"])
    expect(directive('base-uri')).toEqual(["'self'"])
  })

  it('lets the app reach Supabase auth and the API, and nothing else', () => {
    const connect = directive('connect-src')
    expect(connect).toContain("'self'")
    expect(connect.some((o) => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(o))).toBe(true)
    expect(connect.some((o) => /^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(o))).toBe(true)
    expect(connect.every((o) => o === "'self'" || o.startsWith('https://'))).toBe(true)
  })

  it('keeps images to this origin and inline data (no remote image beacons)', () => {
    expect(directive('img-src')).toEqual(["'self'", 'data:', 'blob:'])
  })

  it('index.html has no inline script the policy would block', () => {
    const tags = html.match(/<script\b[^>]*>/g) ?? []
    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) expect(tag, tag).toMatch(/\ssrc=/)
    expect(html).not.toMatch(/\son[a-z]+=["']/i) // inline event handlers
  })

  it('loads no fonts or styles from another origin', () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/)
    expect(directive('font-src').every((s) => s === "'self'" || s === 'data:')).toBe(true)
  })
})
