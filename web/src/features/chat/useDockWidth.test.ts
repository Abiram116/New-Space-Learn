import { describe, expect, it } from 'vitest'
import { DOCK_MAX, DOCK_MIN, clamp, maxWidth } from './useDockWidth'

describe('sidebar width limits', () => {
  it('never goes below the floor or above the ceiling, however far it is dragged', () => {
    expect(clamp(50, 1600)).toBe(DOCK_MIN)
    expect(clamp(5000, 1600)).toBe(DOCK_MAX)
  })

  it('leaves everything between the limits exactly as dragged', () => {
    for (const px of [DOCK_MIN, 320, 380, DOCK_MAX]) expect(clamp(px, 1600)).toBe(px)
  })

  it('leaves the chat its room on a narrow window', () => {
    expect(maxWidth(1024)).toBe(324) // 1024 - 700: what is left after the chat has its room
    expect(maxWidth(1100)).toBe(400)
    expect(maxWidth(1600)).toBe(DOCK_MAX)
    expect(clamp(DOCK_MAX, 1100)).toBe(400)
  })

  it('the limits are 300 and 440', () => {
    expect([DOCK_MIN, DOCK_MAX]).toEqual([300, 440])
  })
})
