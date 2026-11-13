import { describe, expect, it } from 'vitest'
import { stripMarkdown } from './text'

describe('stripMarkdown task markers', () => {
  it('turns task list markers into ballot boxes instead of raw brackets', () => {
    expect(stripMarkdown('- [ ] buy milk\n- [x] call mum')).toBe('☐ buy milk ☑ call mum')
    expect(stripMarkdown('[X] shipped')).toBe('☑ shipped')
  })

  it('leaves links and plain bullets alone', () => {
    expect(stripMarkdown('- [docs](http://x.y) here')).toBe('docs here')
    expect(stripMarkdown('- plain')).toBe('plain')
  })
})

describe('emphasis is not maths', () => {
  it('keeps underscores and asterisks that are part of an expression', async () => {
    const mod = await import('./text')
    const strip = Object.values(mod).find((f) => typeof f === 'function') as (s: string) => string
    expect(strip('x_1 + x_2')).toBe('x_1 + x_2')
    expect(strip('2 * 3 * 4')).toBe('2 * 3 * 4')
    expect(strip('an *important* point and _this_ too')).toBe('an important point and this too')
  })
})
