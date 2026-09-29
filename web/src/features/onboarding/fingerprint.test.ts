import { describe, expect, it } from 'vitest'
import {
  CORE_R,
  FORM_BY_VALUE,
  ORBIT_BY_VALUE,
  PLATE_R,
  RINGS_BY_VALUE,
  SAMPLES,
  STAR_R,
  contourPath,
  fingerprint,
  legend,
} from './fingerprint'
import { EMPTY_ANSWERS, STEPS, type Answers, type ChoiceStep } from './steps'

/**
 * The drawing makes one promise: it is a function of the answers. Same
 * answers, same picture — on any device, on any day — and every mark on it can
 * be traced to something the student said.
 */

const opts = (id: string) => (STEPS.find((s) => s.id === id) as ChoiceStep).options
const values = (id: string) => opts(id).map((o) => o.value)

const FULL: Answers = {
  name: 'Abiram',
  styles: [values('style')[0], values('style')[3]],
  depth: values('depth')[2],
  session: '60',
  goal: 'GATE 2027',
}

describe('fingerprint is deterministic', () => {
  it('draws the same picture for the same answers', () => {
    expect(fingerprint(FULL)).toEqual(fingerprint({ ...FULL, styles: [...FULL.styles] }))
  })

  it('does not care about the order styles were tapped in', () => {
    expect(fingerprint({ ...FULL, styles: [...FULL.styles].reverse() })).toEqual(fingerprint(FULL))
  })

  it('treats case and stray spacing as the same name', () => {
    expect(fingerprint({ ...FULL, name: '  abiram ' }).core).toEqual(fingerprint(FULL).core)
  })

  it('is seeded by the name — two people with the same answers still differ', () => {
    expect(fingerprint({ ...FULL, name: 'Maya' }).core).not.toEqual(fingerprint(FULL).core)
  })

  it('reshapes the core when the learning style changes', () => {
    const a = fingerprint({ ...FULL, styles: [values('style')[0]] }).core
    const b = fingerprint({ ...FULL, styles: [values('style')[1]] }).core
    expect(a).not.toEqual(b)
  })
})

describe('every answer the intake can give draws something', () => {
  // A reworded option would otherwise draw nothing for an answer the student
  // gave — the failure these maps exist to prevent, and a silent one.
  it('maps every style option to a shape family', () => {
    for (const v of values('style')) expect(FORM_BY_VALUE[v]).toBeDefined()
  })
  it('maps every depth option to rings', () => {
    for (const v of values('depth')) expect(RINGS_BY_VALUE[v]?.length).toBeGreaterThan(0)
  })
  it('maps every session option to an orbit', () => {
    for (const v of values('session')) expect(ORBIT_BY_VALUE[v]).toBeDefined()
  })
})

describe('one layer per answer', () => {
  it('draws only a bare seed before anything is answered', () => {
    const fp = fingerprint(EMPTY_ANSWERS)
    expect(fp.named).toBe(false)
    expect(fp.rings).toEqual([])
    expect(fp.orbit).toBeNull()
    expect(fp.star).toBeNull()
    expect(Object.values(fp.weights).every((w) => w === 0)).toBe(true)
  })

  it('adds each layer as its answer arrives', () => {
    const fp = fingerprint(FULL)
    expect(fp.named).toBe(true)
    expect(fp.weights.examples).toBe(0.5)
    expect(fp.weights.comparison).toBe(0.5)
    expect(fp.rings.length).toBe(4)
    expect(fp.orbit?.sweep).toBe(0.5)
    expect(fp.star?.text).toBe('GATE 2027')
  })

  it('shortens a long goal on the dial only', () => {
    const star = fingerprint({ ...FULL, goal: 'x'.repeat(140) }).star!
    expect(star.text.length).toBeLessThanOrEqual(52)
    expect(star.text.endsWith('…')).toBe(true)
  })
})

describe('the layers never collide', () => {
  it('keeps the outermost ring inside the smallest orbit, and the orbit inside the star', () => {
    for (const style of [[], ...values('style').map((v) => [v]), values('style')]) {
      const core = fingerprint({ ...FULL, styles: style }).core
      const widest = Math.max(...core) * Math.max(...Object.values(RINGS_BY_VALUE).flat())
      const smallest = Math.min(...Object.values(ORBIT_BY_VALUE).map((o) => o.r))
      expect(widest).toBeLessThan(smallest)
    }
    const largest = Math.max(...Object.values(ORBIT_BY_VALUE).map((o) => o.r))
    expect(largest).toBeLessThan(STAR_R)
    expect(STAR_R).toBeLessThan(PLATE_R)
  })

  it('keeps the core near its nominal size whatever the style', () => {
    for (const v of values('style')) {
      const core = fingerprint({ ...FULL, styles: [v] }).core
      const mean = core.reduce((a, b) => a + b, 0) / core.length
      expect(Math.abs(mean - CORE_R) / CORE_R).toBeLessThan(0.08)
    }
  })
})

describe('contourPath', () => {
  it('is a closed path with one segment per sample and no NaNs', () => {
    const d = contourPath(fingerprint(FULL).core)
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d.match(/Q/g)?.length).toBe(SAMPLES)
    expect(d).not.toMatch(/NaN|Infinity/)
  })
})

describe('legend', () => {
  it('names the source of every layer in the student’s own terms', () => {
    const rows = legend(FULL)
    expect(rows.map((r) => r.key)).toEqual(['seed', 'core', 'rings', 'orbit', 'star'])
    expect(rows[1].text).toContain(opts('style')[0].hint)
    expect(rows[2].text).toBe(opts('depth')[2].hint)
    expect(rows[4].text).toBe('GATE 2027')
  })

  it('fills in nothing that was not answered', () => {
    expect(legend(EMPTY_ANSWERS)).toEqual([])
    expect(legend({ ...EMPTY_ANSWERS, session: '15' }).map((r) => r.key)).toEqual(['orbit'])
  })
})
