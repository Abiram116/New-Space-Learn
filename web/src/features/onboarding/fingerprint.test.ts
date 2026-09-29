import { describe, expect, it } from 'vitest'
import {
  DEPTH_BY_VALUE,
  FORM_BY_VALUE,
  SESSION_BY_VALUE,
  SLOTS,
  approachParams,
  armAngle,
  band,
  home,
  lerpAngle,
  lerpParams,
  legend,
  paramsFor,
  spinRate,
  type Home,
  type Mote,
  type Params,
} from './fingerprint'
import { EMPTY_ANSWERS, STEPS, type Answers, type ChoiceStep } from './steps'

/**
 * The organism makes two promises. It is a function of the answers — same
 * answers, same organism, on any device, on any day, with every structure
 * traceable to something the student said. And it *changes* by interpolation:
 * moving between two sets of answers is a continuous, deterministic path, so
 * nothing on screen can ever pop.
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

/** Every number in a params object, flattened, for "is it finite" and
 *  "how far apart" checks. */
const flat = (p: Params) => Object.values(p).flatMap((v) => (Array.isArray(v) ? v : [v]))
const colourOf = (p: Params, c: number) => p.colour.slice(c * SLOTS.length, (c + 1) * SLOTS.length)

describe('parameters are a pure function of the answers', () => {
  it('grows the same organism for the same answers', () => {
    expect(paramsFor(FULL)).toEqual(paramsFor({ ...FULL, styles: [...FULL.styles] }))
  })

  it('does not care about the order styles were tapped in', () => {
    expect(paramsFor({ ...FULL, styles: [...FULL.styles].reverse() })).toEqual(paramsFor(FULL))
  })

  it('treats case and stray spacing as the same name', () => {
    expect(paramsFor({ ...FULL, name: '  abiram ' })).toEqual(paramsFor(FULL))
  })

  it('is seeded by the name — two people with the same answers still differ', () => {
    const a = paramsFor(FULL)
    const b = paramsFor({ ...FULL, name: 'Maya' })
    expect([a.tilt, a.spin, a.starAngle]).not.toEqual([b.tilt, b.spin, b.starAngle])
  })

  it('is colourless until there is a name, and takes a signature from it', () => {
    const ink = SLOTS.indexOf('ink')
    const none = paramsFor(EMPTY_ANSWERS)
    for (let c = 0; c < 3; c++) expect(colourOf(none, c)[ink]).toBe(1)
    const named = paramsFor({ ...EMPTY_ANSWERS, name: 'Abiram' })
    expect(colourOf(named, 0)[ink]).toBe(0)
  })

  it('changes the flow when the learning style changes', () => {
    const a = paramsFor({ ...FULL, styles: [values('style')[0]] })
    const b = paramsFor({ ...FULL, styles: [values('style')[1]] })
    expect(a.form).not.toEqual(b.form)
    expect(a.form.reduce((x, y) => x + y)).toBeCloseTo(1)
  })

  it('never produces a non-finite number', () => {
    for (const a of [EMPTY_ANSWERS, FULL, { ...FULL, styles: values('style') }]) {
      expect(flat(paramsFor(a)).every(Number.isFinite)).toBe(true)
    }
  })
})

describe('every answer the intake can give moves something', () => {
  // A reworded option would otherwise do nothing for an answer the student
  // gave — the failure these maps exist to prevent, and a silent one.
  it('maps every style option to a flow family', () => {
    for (const v of values('style')) expect(FORM_BY_VALUE[v]).toBeDefined()
  })
  it('maps every depth option to layers', () => {
    for (const v of values('depth')) expect(DEPTH_BY_VALUE[v]?.layers).toBeGreaterThan(0)
  })
  it('maps every session option to a tempo and an orbit', () => {
    for (const v of values('session')) expect(SESSION_BY_VALUE[v]).toBeDefined()
  })
  it('turns a structure on only once its answer exists', () => {
    const none = paramsFor(EMPTY_ANSWERS)
    expect(none.layers).toBe(0)
    expect(none.orbit).toBe(0)
    expect(none.star).toBe(0)
    expect(none.form.every((w) => w === 0)).toBe(true)
    const full = paramsFor(FULL)
    expect(full.layers).toBe(4)
    expect(full.orbit).toBe(1)
    expect(full.sweep).toBe(0.5)
    expect(full.star).toBe(1)
  })
  it('turns longer sessions more slowly', () => {
    const tempos = ['15', '30', '60', '120'].map((s) => paramsFor({ ...FULL, session: s }).tempo)
    for (let i = 1; i < tempos.length; i++) expect(tempos[i]).toBeLessThan(tempos[i - 1])
  })
})

describe('interpolation', () => {
  const A = paramsFor(EMPTY_ANSWERS)
  const B = paramsFor(FULL)

  it('starts at the start and ends at the end', () => {
    expect(lerpParams(A, B, 0)).toEqual(A)
    const end = lerpParams(A, B, 1)
    for (const [i, v] of flat(end).entries()) expect(v).toBeCloseTo(flat(B)[i], 9)
  })

  it('is deterministic and leaves its inputs alone', () => {
    const before = JSON.stringify([A, B])
    expect(lerpParams(A, B, 0.37)).toEqual(lerpParams(A, B, 0.37))
    expect(JSON.stringify([A, B])).toBe(before)
  })

  it('turns angles the short way round', () => {
    expect(lerpAngle(0.1, Math.PI * 2 - 0.1, 0.5)).toBeCloseTo(0, 9)
    // 3 → −3 rad is a short hop across π, not a trip back through zero.
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 9)
  })

  it('is frame-rate independent: two half-steps land where one whole step does', () => {
    const whole = approachParams(A, B, 1 / 30, 1.4)
    const halves = approachParams(approachParams(A, B, 1 / 60, 1.4), B, 1 / 60, 1.4)
    for (const [i, v] of flat(whole).entries()) expect(flat(halves)[i]).toBeCloseTo(v, 9)
  })

  it('converges on the target and never overshoots it', () => {
    let p = A
    let prevGap = Infinity
    for (let i = 0; i < 600; i++) {
      p = approachParams(p, B, 1 / 60, 1.4)
      const gap = Math.abs(p.energy - B.energy)
      expect(gap).toBeLessThanOrEqual(prevGap)
      prevGap = gap
    }
    expect(p.energy).toBeCloseTo(B.energy, 3)
    expect(p.layers).toBeCloseTo(B.layers, 3)
  })
})

describe('the field', () => {
  const mote: Mote = { a: 1.2, l: 0.63, j: 0.4, k: 0.3, o: 0.5, ph: 0.2, s: 0.5 }
  const out = (): Home => ({ x: 0, y: 0, alpha: 1, tone: 0, stream: -1, size: 1 })

  it('puts a particle in the same place for the same inputs', () => {
    const P = paramsFor(FULL)
    expect(home(P, mote, 3.2, out())).toEqual(home(P, mote, 3.2, out()))
  })

  it('never jumps while parameters interpolate', () => {
    // Sweep from nothing answered to everything answered in small steps:
    // each step may only move a particle a little. A swap would show as one
    // large step.
    const A = paramsFor(EMPTY_ANSWERS)
    const B = paramsFor(FULL)
    for (const m of [mote, { ...mote, o: 0.05 }, { ...mote, o: 0.97 }, { ...mote, k: 0.8, l: 0.1 }, { ...mote, ph: 0.9, k: 0.6 }]) {
      let prev = home(A, m, 2, out())
      for (let i = 1; i <= 200; i++) {
        const h = home(lerpParams(A, B, i / 200), m, 2, out())
        expect(Math.hypot(h.x - prev.x, h.y - prev.y)).toBeLessThan(0.08)
        prev = h
      }
    }
  })

  it('stays within the organism’s reach', () => {
    const P = paramsFor({ ...FULL, session: '120' })
    for (let i = 0; i < 400; i++) {
      const m: Mote = { a: i * 0.37, l: (i * 0.618) % 1, j: (i * 0.31) % 1, k: (i * 0.77) % 1, o: (i * 0.13) % 1, ph: (i * 0.41) % 1, s: 0.5 }
      const h = home(P, m, i * 0.1, out())
      expect(Math.hypot(h.x, h.y)).toBeLessThan(1.35)
    }
  })

  it('divides arms rather than jumping stars between them', () => {
    for (const k of [0.1, 0.3, 0.49, 0.51, 0.7, 0.95]) {
      expect(Math.abs(armAngle(k, 2.999) - armAngle(k, 3))).toBeLessThan(0.02)
      expect(Math.abs(armAngle(k, 3.001) - armAngle(k, 3))).toBeLessThan(0.02)
    }
  })

  it('turns the core faster than the rim — differential rotation', () => {
    const P = paramsFor(FULL)
    expect(spinRate(P, { ...mote, l: 0.05 })).toBeGreaterThan(spinRate(P, { ...mote, l: 0.95 }) * 3)
  })

  it('slides between layer counts instead of snapping', () => {
    for (const l of [0.1, 0.33, 0.5, 0.77, 0.95]) {
      expect(Math.abs(band(l, 2.999, 0.8) - band(l, 3, 0.8))).toBeLessThan(0.01)
      expect(band(l, 0, 0.8)).toBe(l)
    }
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
