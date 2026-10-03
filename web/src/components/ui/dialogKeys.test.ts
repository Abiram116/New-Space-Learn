// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { moveAcrossActions } from './dialogKeys'

const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, cancelable: true, ...init })

function mount(html: string) {
  document.body.innerHTML = html
}
const el = (id: string) => document.getElementById(id) as HTMLElement

afterEach(() => {
  document.body.innerHTML = ''
})

describe('moveAcrossActions', () => {
  const row = `<div data-dialog-actions>
    <button id="a">Cancel</button><button id="b">Leave</button><button id="c">Third</button>
  </div>`

  it('moves along the row and stops at the ends', () => {
    mount(row)
    el('a').focus()
    expect(moveAcrossActions(key('ArrowRight'))).toBe(true)
    expect(document.activeElement).toBe(el('b'))
    moveAcrossActions(key('ArrowRight'))
    moveAcrossActions(key('ArrowRight'))
    expect(document.activeElement).toBe(el('c'))
    moveAcrossActions(key('ArrowLeft'))
    moveAcrossActions(key('ArrowLeft'))
    moveAcrossActions(key('ArrowLeft'))
    expect(document.activeElement).toBe(el('a'))
  })

  it('skips disabled buttons and the focus-trap exclusions', () => {
    mount(`<div data-dialog-actions>
      <button id="a">A</button><button id="x" disabled>X</button>
      <button id="y" tabindex="-1">Y</button><button id="b">B</button></div>`)
    el('a').focus()
    moveAcrossActions(key('ArrowRight'))
    expect(document.activeElement).toBe(el('b'))
  })

  it('prevents the default only when it actually handled the key', () => {
    mount(row)
    el('a').focus()
    const handled = key('ArrowRight')
    moveAcrossActions(handled)
    expect(handled.defaultPrevented).toBe(true)
    const other = key('ArrowDown')
    expect(moveAcrossActions(other)).toBe(false)
    expect(other.defaultPrevented).toBe(false)
  })

  it('leaves everything outside a dialog action row alone', () => {
    mount(`<button id="loose">Loose</button><input id="field" />${row}`)
    for (const id of ['loose', 'field']) {
      el(id).focus()
      const e = key('ArrowRight')
      expect(moveAcrossActions(e)).toBe(false)
      expect(e.defaultPrevented).toBe(false)
    }
  })

  it('ignores arrows combined with a modifier', () => {
    mount(row)
    el('a').focus()
    expect(moveAcrossActions(key('ArrowRight', { shiftKey: true }))).toBe(false)
    expect(moveAcrossActions(key('ArrowRight', { metaKey: true }))).toBe(false)
    expect(document.activeElement).toBe(el('a'))
  })
})
