import { describe, expect, it } from 'vitest'
import {
  backdropOpacity,
  DISMISS_MAX_PX,
  FLICK_MIN_PX,
  FLICK_VELOCITY,
  sheetDragOffset,
  shouldDismissSheet,
} from './sheetDrag'
import { isKeyboardOpen, keyboardInset } from './useKeyboard'

describe('sheetDragOffset', () => {
  it('follows the finger down 1:1', () => {
    expect(sheetDragOffset(0)).toBe(0)
    expect(sheetDragOffset(80)).toBe(80)
  })

  it('resists and caps an upward pull', () => {
    expect(sheetDragOffset(-40)).toBe(-10)
    expect(sheetDragOffset(-400)).toBe(-24)
  })
})

describe('shouldDismissSheet', () => {
  const height = 400

  it('snaps back from a short, slow drag', () => {
    expect(shouldDismissSheet({ dy: 60, velocity: 0.1, height })).toBe(false)
  })

  it('dismisses past ~30% of the sheet', () => {
    expect(shouldDismissSheet({ dy: 121, velocity: 0, height })).toBe(true)
  })

  it('caps the distance on tall sheets so they are not a marathon to close', () => {
    expect(shouldDismissSheet({ dy: DISMISS_MAX_PX, velocity: 0, height: 2000 })).toBe(true)
    expect(shouldDismissSheet({ dy: DISMISS_MAX_PX - 1, velocity: 0, height: 2000 })).toBe(false)
  })

  it('dismisses a quick downward flick even if it is short', () => {
    expect(shouldDismissSheet({ dy: FLICK_MIN_PX, velocity: FLICK_VELOCITY, height })).toBe(true)
  })

  it('does not treat a tap on the handle as a flick', () => {
    expect(shouldDismissSheet({ dy: 4, velocity: 2, height })).toBe(false)
  })

  it('never dismisses on an upward drag', () => {
    expect(shouldDismissSheet({ dy: -200, velocity: -3, height })).toBe(false)
    expect(shouldDismissSheet({ dy: 0, velocity: 3, height })).toBe(false)
  })
})

describe('backdropOpacity', () => {
  it('fades as the sheet leaves', () => {
    expect(backdropOpacity(0, 400)).toBe(1)
    expect(backdropOpacity(200, 400)).toBe(0.5)
    expect(backdropOpacity(800, 400)).toBe(0)
  })
})

describe('keyboard detection', () => {
  it('ignores a URL bar collapsing, sees a keyboard', () => {
    expect(isKeyboardOpen(844, 780)).toBe(false)
    expect(isKeyboardOpen(844, 500)).toBe(true)
  })

  it('lifts only by what the keyboard covers', () => {
    expect(keyboardInset(844, 500, 0)).toBe(344)
    expect(keyboardInset(500, 500, 0)).toBe(0)
    expect(keyboardInset(844, 500, 20)).toBe(324)
  })
})
