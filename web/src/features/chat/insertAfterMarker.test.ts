import { describe, expect, it } from 'vitest'
import { insertAfterMarker } from './insertAfterMarker'

const FENCE = '```'

describe('insertAfterMarker', () => {
  it('appends at the end without a marker', () => {
    expect(insertAfterMarker('A\n\n', '', 'B')).toEqual({ body: 'A\n\nB', found: false })
  })

  it('lands directly under a matching heading', () => {
    const { body } = insertAfterMarker('## Encoder\nText.\n\n## Decoder', 'encoder', 'NEW')
    expect(body).toBe('## Encoder\n\nNEW\n\nText.\n\n## Decoder')
  })

  it('never lands inside a code block — it goes after the closing fence', () => {
    const note = `Intro\n\n${FENCE}python\nencoder = build()\nrun(encoder)\n${FENCE}\n\nAfter`
    const { body } = insertAfterMarker(note, 'encoder', 'NEW')
    expect(body).toBe(`Intro\n\n${FENCE}python\nencoder = build()\nrun(encoder)\n${FENCE}\n\nNEW\n\nAfter`)
  })

  it('does not split a table or a list', () => {
    const table = '| a | b |\n| --- | --- |\n| key | 1 |\n| other | 2 |\n\nEnd'
    expect(insertAfterMarker(table, 'key', 'NEW').body).toBe(
      '| a | b |\n| --- | --- |\n| key | 1 |\n| other | 2 |\n\nNEW\n\nEnd',
    )
    const list = '- first\n- second\n- third'
    expect(insertAfterMarker(list, 'first', 'NEW').body).toBe('- first\n- second\n- third\n\nNEW')
  })

  it('matches what the note shows, not its escaped source', () => {
    const { found, body } = insertAfterMarker('self\\_attention is key\n\nMore', 'self_attention', 'NEW')
    expect(found).toBe(true)
    expect(body).toBe('self\\_attention is key\n\nNEW\n\nMore')
  })
})
