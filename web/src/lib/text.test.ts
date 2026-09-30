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
