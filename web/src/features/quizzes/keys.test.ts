// @vitest-environment jsdom
/**
 * The quiz stage's key map and the gate every stage listener passes through,
 * as pure logic — no component, no timers.
 */

import { describe, expect, it } from 'vitest'
import { anyModalOpen, directChoice, quizKeyAction, stageKeyGate, type QuizKeyState } from './keys'

const fresh: QuizKeyState = { revealed: false, highlight: -1, count: 4 }

describe('quizKeyAction — before answering', () => {
  it('the first arrow, in either direction, lands on the first option', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'j', 'k']) {
      expect(quizKeyAction(key, fresh)).toEqual({ type: 'highlight', index: 0 })
    }
  })

  it('arrows and j/k move the highlight and wrap at both ends', () => {
    expect(quizKeyAction('ArrowDown', { ...fresh, highlight: 1 })).toEqual({ type: 'highlight', index: 2 })
    expect(quizKeyAction('j', { ...fresh, highlight: 3 })).toEqual({ type: 'highlight', index: 0 })
    expect(quizKeyAction('ArrowUp', { ...fresh, highlight: 0 })).toEqual({ type: 'highlight', index: 3 })
    expect(quizKeyAction('k', { ...fresh, highlight: 2 })).toEqual({ type: 'highlight', index: 1 })
    expect(quizKeyAction('ArrowLeft', { ...fresh, highlight: 2 })).toEqual({ type: 'highlight', index: 1 })
    expect(quizKeyAction('ArrowRight', { ...fresh, highlight: 2 })).toEqual({ type: 'highlight', index: 3 })
  })

  it('Enter / Space choose the highlighted option', () => {
    expect(quizKeyAction('Enter', { ...fresh, highlight: 2 })).toEqual({ type: 'choose', index: 2 })
    expect(quizKeyAction(' ', { ...fresh, highlight: 1 })).toEqual({ type: 'choose', index: 1 })
  })

  it('Enter with nothing highlighted highlights rather than guessing', () => {
    expect(quizKeyAction('Enter', fresh)).toEqual({ type: 'highlight', index: 0 })
  })

  it('a focused option wins over a stale highlight', () => {
    expect(quizKeyAction('Enter', { ...fresh, highlight: 0, focused: 3 })).toEqual({ type: 'choose', index: 3 })
    expect(quizKeyAction('ArrowDown', { ...fresh, highlight: 0, focused: 2 })).toEqual({ type: 'highlight', index: 3 })
  })

  it('1–4 and A–D (either case) choose directly', () => {
    expect(quizKeyAction('1', fresh)).toEqual({ type: 'choose', index: 0 })
    expect(quizKeyAction('4', fresh)).toEqual({ type: 'choose', index: 3 })
    expect(quizKeyAction('b', fresh)).toEqual({ type: 'choose', index: 1 })
    expect(quizKeyAction('D', fresh)).toEqual({ type: 'choose', index: 3 })
  })

  it('a direct key past the last option does nothing', () => {
    expect(quizKeyAction('5', fresh)).toBeNull()
    expect(quizKeyAction('c', { ...fresh, count: 2 })).toBeNull()
  })

  it('Esc asks to leave; unrelated keys are not ours', () => {
    expect(quizKeyAction('Escape', fresh)).toEqual({ type: 'leave' })
    expect(quizKeyAction('x', fresh)).toBeNull()
    expect(quizKeyAction('Tab', fresh)).toBeNull()
  })
})

describe('quizKeyAction — once answered', () => {
  const answered = { ...fresh, revealed: true, highlight: 2 }

  it('Enter / Space move on', () => {
    expect(quizKeyAction('Enter', answered)).toEqual({ type: 'advance' })
    expect(quizKeyAction(' ', answered)).toEqual({ type: 'advance' })
    // Even with the (now disabled) picked option still holding focus.
    expect(quizKeyAction('Enter', { ...answered, focused: 1 })).toEqual({ type: 'advance' })
  })

  it('the answer is locked: arrows and direct keys do nothing', () => {
    for (const key of ['ArrowDown', 'k', '1', 'a']) expect(quizKeyAction(key, answered)).toBeNull()
  })

  it('Esc still asks to leave', () => {
    expect(quizKeyAction('Escape', answered)).toEqual({ type: 'leave' })
  })
})

describe('directChoice', () => {
  it('maps digits and letters to indexes', () => {
    expect(directChoice('1')).toBe(0)
    expect(directChoice('a')).toBe(0)
    expect(directChoice('C')).toBe(2)
    expect(directChoice('0')).toBeNull()
    expect(directChoice('Enter')).toBeNull()
  })
})

describe('stageKeyGate', () => {
  const base = {
    key: 'Enter',
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    target: document.body as EventTarget,
  }
  const opts = { ownAttr: 'data-own', wouldHandle: true }

  it('handles a plain key on the page', () => {
    expect(stageKeyGate(base, opts)).toBe('handle')
  })

  it('swallows a held key instead of acting on it again', () => {
    expect(stageKeyGate({ ...base, repeat: true }, opts)).toBe('swallow')
  })

  it('never fires while typing', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const el = document.createElement(tag)
      expect(stageKeyGate({ ...base, target: el }, opts)).toBe('ignore')
    }
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    editable.appendChild(inner)
    expect(stageKeyGate({ ...base, target: inner }, opts)).toBe('ignore')
  })

  it('leaves modifier chords, open modals and keys we would not handle alone', () => {
    expect(stageKeyGate({ ...base, ctrlKey: true }, opts)).toBe('ignore')
    expect(stageKeyGate({ ...base, metaKey: true }, opts)).toBe('ignore')
    expect(stageKeyGate(base, { ...opts, modalOpen: true })).toBe('ignore')
    expect(stageKeyGate(base, { ...opts, wouldHandle: false })).toBe('ignore')
    expect(stageKeyGate({ ...base, defaultPrevented: true }, opts)).toBe('ignore')
  })

  it('Enter / Space on a foreign control is left to the browser; on our own, it is ours', () => {
    const foreign = document.createElement('button')
    expect(stageKeyGate({ ...base, target: foreign }, opts)).toBe('ignore')
    expect(stageKeyGate({ ...base, key: ' ', target: foreign }, opts)).toBe('ignore')
    // Arrows are still ours even with a foreign control focused.
    expect(stageKeyGate({ ...base, key: 'ArrowDown', target: foreign }, opts)).toBe('handle')

    const own = document.createElement('button')
    own.setAttribute('data-own', '')
    const icon = document.createElement('span')
    own.appendChild(icon)
    expect(stageKeyGate({ ...base, target: icon }, opts)).toBe('handle')
  })
})

describe('after an answer, "next" works the way it does everywhere else', () => {
  const answered = { ...fresh, revealed: true, highlight: 2 }
  it('→ and n go on, as do Enter and Space', () => {
    for (const key of ['ArrowRight', 'n', 'N', 'Enter', ' ']) {
      expect(quizKeyAction(key, answered)).toEqual({ type: 'advance' })
    }
  })
  it('but a stray down / j / k cannot skip the explanation', () => {
    for (const key of ['ArrowDown', 'j', 'k']) expect(quizKeyAction(key, answered)).toBeNull()
  })
})

describe('anyModalOpen', () => {
  const mount = (html: string) => {
    document.body.innerHTML = html
  }

  it('is false for the always-mounted, closed navigation drawer', () => {
    // Exactly how AppShell renders it while closed.
    mount('<div role="dialog" aria-modal="true" aria-hidden="true" aria-label="Navigation"></div>')
    expect(anyModalOpen()).toBe(false)
  })

  it('is false when the modal is inside a hidden subtree', () => {
    mount('<div aria-hidden="true"><div role="dialog" aria-modal="true"></div></div>')
    expect(anyModalOpen()).toBe(false)
  })

  it('is true for a dialog that is on screen', () => {
    mount('<div role="dialog" aria-modal="true" aria-label="Leave quiz?"></div>')
    expect(anyModalOpen()).toBe(true)
  })

  it('is true when an open dialog sits beside the closed drawer', () => {
    mount(
      '<div role="dialog" aria-modal="true" aria-hidden="true"></div><div role="dialog" aria-modal="true"></div>',
    )
    expect(anyModalOpen()).toBe(true)
  })
})

