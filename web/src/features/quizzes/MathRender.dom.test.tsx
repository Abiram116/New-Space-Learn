// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)
import { MathText } from '../chat/MarkdownMessage'

describe('MathText in study screens', () => {
  it('does not leave the \\( \\) delimiters on screen', async () => {
    const { container, findByText } = render(<p><MathText content={'Antiderivative of \\(\\int \\sec^{2}x\\,dx\\)?'} /></p>)
    await findByText(/Antiderivative of/)
    expect(container.textContent).not.toContain('\\(')
  })
})
