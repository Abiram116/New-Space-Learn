/**
 * Test helper: make `useIsMobile()` see a phone. jsdom has no `matchMedia`,
 * so without this every test renders the desktop layout — which is exactly
 * what the existing desktop tests rely on. Only the phone tests opt in.
 */

import { vi } from 'vitest'

export function mockPhone(): () => void {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
  return () => {
    window.matchMedia = original
    vi.restoreAllMocks()
  }
}
