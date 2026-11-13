import { describe, expect, it } from 'vitest'
import { reflow } from './reflow'

describe('reflow', () => {
  it('joins hard-wrapped lines, keeps headings apart and ends a paragraph on a short closing line', () => {
    const text = [
      '5.1 Training Data and Batching',
      'We trained on the standard WMT 2014 English-German dataset consisting of about 4.5 million',
      'sentence pairs. Sentences were encoded using byte-pair encoding [3], which has a shared source-',
      'target vocabulary of about 37000 tokens.',
      '5.2 Hardware and Schedule',
      'We trained our models on one machine with 8 NVIDIA P100 GPUs for twelve hours in total across all runs.',
    ].join('\n')
    expect(reflow(text)).toEqual([
      { kind: 'heading', text: '5.1 Training Data and Batching' },
      {
        kind: 'p',
        text: 'We trained on the standard WMT 2014 English-German dataset consisting of about 4.5 million sentence pairs. Sentences were encoded using byte-pair encoding [3], which has a shared source-target vocabulary of about 37000 tokens.',
      },
      { kind: 'heading', text: '5.2 Hardware and Schedule' },
      { kind: 'p', text: 'We trained our models on one machine with 8 NVIDIA P100 GPUs for twelve hours in total across all runs.' },
    ])
  })
  it('handles empty and single-line text', () => {
    expect(reflow('')).toEqual([])
    expect(reflow('Just one line.')).toEqual([{ kind: 'p', text: 'Just one line.' }])
  })
})
