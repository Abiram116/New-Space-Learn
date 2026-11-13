// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Icon3D } from './Icon3D'

afterEach(cleanup)

describe('Icon3D', () => {
  it('is decorative, sized to the glyph, and builds a stepped wall, a face and a sheen', () => {
    const { container } = render(<Icon3D name="lock" size={20} />)
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('aria-hidden')
    expect(root.style.width).toBe('20px')
    expect(root.querySelectorAll('.icon3d-wall').length).toBeGreaterThanOrEqual(2)
    expect(root.querySelectorAll('.icon3d-rim')).toHaveLength(1)
    expect(root.querySelector('.icon3d-face svg')).not.toBeNull()
    expect(root.querySelector('.icon3d-sheen svg')).not.toBeNull()
    expect(root).not.toHaveAttribute('data-lifted')
  })

  it('marks a lifted icon for the stylesheet and keeps the caller’s class', () => {
    const { container } = render(<Icon3D name="lock" size={14} lifted className="text-sky" />)
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('data-lifted')
    expect(root).toHaveClass('icon3d', 'text-sky')
  })
})
