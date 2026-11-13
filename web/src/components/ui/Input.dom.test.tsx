// @vitest-environment jsdom
/**
 * A field's label and its error both have to be tied to the box itself, or a
 * screen reader announces an unnamed field and never reads why it was refused.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Input, Textarea } from './Input'

afterEach(cleanup)

describe.each([
  ['Input', Input],
  ['Textarea', Textarea],
] as const)('%s', (_name, Field) => {
  it('names the field from its label even with no id or name', () => {
    render(
      <>
        <Field label="Title" />
        <Field label="Body" />
      </>,
    )
    const title = screen.getByLabelText('Title')
    const body = screen.getByLabelText('Body')
    expect(title.id).not.toBe('')
    expect(title.id).not.toBe(body.id)
  })

  it('keeps an id or name it was given', () => {
    render(
      <>
        <Field label="A" id="given" name="other" />
        <Field label="B" name="named" />
      </>,
    )
    expect(screen.getByLabelText('A')).toHaveAttribute('id', 'given')
    expect(screen.getByLabelText('B')).toHaveAttribute('id', 'named')
  })

  it('ties the error to the field', () => {
    render(<Field label="Title" error="Give it a name." />)
    const field = screen.getByLabelText('Title')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Give it a name.')
  })

  it('leaves a description the caller supplied alone while there is no error', () => {
    render(
      <>
        <Field label="Title" aria-describedby="why" />
        <p id="why">Shown on the card.</p>
      </>,
    )
    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription('Shown on the card.')
  })
})
