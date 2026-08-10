// @vitest-environment jsdom
/**
 * The assessment lock.
 *
 * Worth testing because both failure directions are silent and both are bad:
 * a lock that never engages makes every quiz score in the app unverifiable,
 * and one that never releases leaves the student unable to type in their own
 * chat with no error to explain why.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssessmentProvider, useAssessment, useAssessmentLock } from './assessment'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** Renders the current lock state into the DOM so tests can read it. */
function Probe() {
  const { assessing, reason } = useAssessment()
  return <span data-testid="state">{assessing ? `locked:${reason}` : 'open'}</span>
}

function Quiz() {
  useAssessmentLock('quiz')
  return null
}

function Review() {
  useAssessmentLock('review')
  return null
}

const state = () => container.querySelector('[data-testid="state"]')?.textContent

function render(ui: React.ReactNode) {
  act(() => {
    root.render(<AssessmentProvider>{ui}</AssessmentProvider>)
  })
}

describe('assessment lock', () => {
  it('is open with nothing running', () => {
    render(<Probe />)
    expect(state()).toBe('open')
  })

  it('locks while a quiz is mounted and names the reason', () => {
    render(
      <>
        <Probe />
        <Quiz />
      </>,
    )
    expect(state()).toBe('locked:quiz')
  })

  it('releases when the assessment unmounts', () => {
    render(
      <>
        <Probe />
        <Quiz />
      </>,
    )
    expect(state()).toBe('locked:quiz')
    // Navigating away, closing the panel and finishing all unmount — which is
    // why the lock is tied to the lifecycle rather than to explicit calls.
    render(<Probe />)
    expect(state()).toBe('open')
  })

  it('stays locked while any one of several assessments is still running', () => {
    // The dock panel and the full page can both be mounted. A boolean would
    // let whichever unmounted first unlock the other one's session.
    render(
      <>
        <Probe />
        <Quiz />
        <Review />
      </>,
    )
    expect(state()).toBe('locked:quiz')

    render(
      <>
        <Probe />
        <Review />
      </>,
    )
    expect(state()).toBe('locked:review')

    render(<Probe />)
    expect(state()).toBe('open')
  })

  it('survives two of the same kind at once', () => {
    render(
      <>
        <Probe />
        <Quiz />
        <Quiz />
      </>,
    )
    expect(state()).toBe('locked:quiz')
    // One closes; the other is still going.
    render(
      <>
        <Probe />
        <Quiz />
      </>,
    )
    expect(state()).toBe('locked:quiz')
  })
})
