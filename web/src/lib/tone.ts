import type { Tone } from '../api/types'

/**
 * The five foil tones. A subject picks one and keeps it everywhere — the rail
 * marker, its cards' edge, its progress. On a dark table these read as ink
 * colors on cardstock, so `soft` is a deep tinted well rather than a pale wash.
 */

export const toneDot: Record<Tone, string> = {
  brand: 'bg-brand',
  sky: 'bg-sky',
  mint: 'bg-mint',
  sun: 'bg-sun',
  coral: 'bg-coral',
  azure: 'bg-azure',
  jade: 'bg-jade',
}

export const toneSoft: Record<Tone, string> = {
  brand: 'bg-brand-soft',
  sky: 'bg-sky-soft',
  mint: 'bg-mint-soft',
  sun: 'bg-sun-soft',
  coral: 'bg-coral-soft',
  azure: 'bg-azure-soft',
  jade: 'bg-jade-soft',
}

export const toneBar: Record<Tone, string> = {
  brand: 'bg-brand',
  sky: 'bg-sky',
  mint: 'bg-mint',
  sun: 'bg-sun',
  coral: 'bg-coral',
  azure: 'bg-azure',
  jade: 'bg-jade',
}

export const toneTrack: Record<Tone, string> = {
  brand: 'bg-brand-soft',
  sky: 'bg-sky-soft',
  mint: 'bg-mint-soft',
  sun: 'bg-sun-soft',
  coral: 'bg-coral-soft',
  azure: 'bg-azure-soft',
  jade: 'bg-jade-soft',
}

/** Legible tone text on a dark ground — the pure hue is too hot for prose. */
export const toneText: Record<Tone, string> = {
  brand: 'text-brand-deep',
  sky: 'text-sky-deep',
  mint: 'text-mint-deep',
  sun: 'text-sun-deep',
  coral: 'text-coral-deep',
  azure: 'text-azure-deep',
  jade: 'text-jade-deep',
}

/** Hairline in the tone, for a card edge that belongs to a subject. */
export const toneEdge: Record<Tone, string> = {
  brand: 'ring-brand/35',
  sky: 'ring-sky/35',
  mint: 'ring-mint/35',
  sun: 'ring-sun/35',
  coral: 'ring-coral/35',
  azure: 'ring-azure/35',
  jade: 'ring-jade/35',
}

/** Raw hex, for canvas/SVG and inline gradients where a class can't reach. */
export const toneHex: Record<Tone, string> = {
  brand: '#FF5A3C',
  sky: '#2EE6D6',
  mint: '#B8FF3C',
  sun: '#FFC53D',
  coral: '#FF3D8B',
  azure: '#4D8DFF',
  jade: '#22D3A0',
}
