/**
 * Link previews are read from the static HTML by crawlers that never run the
 * app, so a typo here fails silently — the card just comes out blank or wrong.
 * These pin the tags, and that the image they point at really exists.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
const html = readFileSync(resolve(root, 'index.html'), 'utf8')
const meta = (attr: 'property' | 'name', key: string) =>
  new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, 's').exec(html)?.[1]

describe('link preview tags', () => {
  it('has the Open Graph and Twitter tags crawlers need', () => {
    for (const key of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'og:image:height'])
      expect(meta('property', key), key).toBeTruthy()
    expect(meta('name', 'twitter:card')).toBe('summary_large_image')
    expect(meta('name', 'description')).toBeTruthy()
  })

  it('uses absolute https URLs, which crawlers require', () => {
    expect(meta('property', 'og:image')).toMatch(/^https:\/\//)
    expect(meta('property', 'og:url')).toMatch(/^https:\/\//)
    expect(meta('name', 'twitter:image')).toMatch(/^https:\/\//)
  })

  it('points at an image that exists, is sized as declared and stays WhatsApp-safe', () => {
    const file = resolve(root, 'public/og-image.jpg')
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).size).toBeLessThan(300 * 1024)
    const buf = readFileSync(file)
    // JPEG SOF0/SOF2 marker carries height then width.
    let i = 2
    while (i < buf.length) {
      const marker = buf[i + 1]
      if (marker === 0xc0 || marker === 0xc2) break
      i += 2 + buf.readUInt16BE(i + 2)
    }
    expect(buf.readUInt16BE(i + 5)).toBe(Number(meta('property', 'og:image:height')))
    expect(buf.readUInt16BE(i + 7)).toBe(Number(meta('property', 'og:image:width')))
  })

  it('keeps robots.txt and the sitemap on the same site as the tags', () => {
    const site = new URL(meta('property', 'og:url')!).origin
    expect(readFileSync(resolve(root, 'public/robots.txt'), 'utf8')).toContain(`Sitemap: ${site}/sitemap.xml`)
    expect(readFileSync(resolve(root, 'public/sitemap.xml'), 'utf8')).toContain(`<loc>${site}/</loc>`)
  })
})
