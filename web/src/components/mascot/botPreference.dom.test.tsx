// @vitest-environment jsdom

/** The Settings switch must remove the characters everywhere but keep the words. */

import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { botsEnabledNow, setBotsEnabled } from '../../lib/botPreference'
import { Bot, BotProgress, BotSays } from '.'

afterEach(() => {
  act(() => setBotsEnabled(true))
  window.localStorage.clear()
})

describe('bot preference', () => {
  it('defaults to on and persists the choice', () => {
    expect(botsEnabledNow()).toBe(true)
    act(() => setBotsEnabled(false))
    expect(botsEnabledNow()).toBe(false)
    expect(window.localStorage.getItem('sl:bots:v1')).toBe('off')
    act(() => setBotsEnabled(true))
    expect(botsEnabledNow()).toBe(true)
    expect(window.localStorage.getItem('sl:bots:v1')).toBeNull()
  })

  it('Bot draws nothing when switched off, and reappears live when switched on', () => {
    const { container } = render(<Bot label="Nova" />)
    expect(container.querySelector('svg.bot')).not.toBeNull()
    act(() => setBotsEnabled(false))
    expect(container.querySelector('svg.bot')).toBeNull()
    act(() => setBotsEnabled(true))
    expect(container.querySelector('svg.bot')).not.toBeNull()
  })

  it('BotSays keeps the words but drops the character and bubble chrome', () => {
    act(() => setBotsEnabled(false))
    const { container } = render(<BotSays>Welcome back, Sam.</BotSays>)
    expect(screen.getByText('Welcome back, Sam.')).toBeTruthy()
    expect(container.querySelector('svg.bot')).toBeNull()
    expect(container.querySelector('.bot-says--plain')).not.toBeNull()
  })

  it('BotProgress keeps the message and the working bar when the bots are off', () => {
    act(() => setBotsEnabled(false))
    const { container } = render(<BotProgress line="Making 8 flashcards…" />)
    expect(screen.getByText('Making 8 flashcards…')).toBeTruthy()
    expect(container.querySelector('svg.bot')).toBeNull()
    expect(container.querySelector('.bot-progress-bar')).not.toBeNull()
  })

  it('never draws on a phone, whatever the preference says', () => {
    const real = window.matchMedia
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    try {
      expect(botsEnabledNow()).toBe(true) // preference is untouched
      const { container } = render(<Bot label="Nova" />)
      expect(container.querySelector('svg.bot')).toBeNull()
      const says = render(<BotSays>Welcome back.</BotSays>)
      expect(says.container.querySelector('.bot-says--plain')).not.toBeNull()
      expect(screen.getByText('Welcome back.')).toBeTruthy()
    } finally {
      window.matchMedia = real
      vi.restoreAllMocks()
    }
  })
})
