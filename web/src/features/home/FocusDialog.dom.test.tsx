// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StudentModel } from '../../api/types'

const me = vi.hoisted(() => ({ updateStudentModel: vi.fn(), getStudentModel: vi.fn() }))
vi.mock('../../api/me', () => me)

import { FocusDialog } from './FocusDialog'

const model = { exam_context: 'GATE CSE 2027', exam_date: null, study_mode: null } as unknown as StudentModel

describe('FocusDialog', () => {
  it('suggests a mode from the goal they already gave, and saves mode, goal and date together', async () => {
    me.updateStudentModel.mockResolvedValue({ ...model, study_mode: 'interview' })
    const onClose = vi.fn()
    render(<FocusDialog model={model} open onClose={onClose} />)
    const user = userEvent.setup()

    // "GATE" reads as competitive before they touch anything.
    expect(screen.getByRole('radio', { name: /GATE or similar/ })).toHaveAttribute('aria-checked', 'true')

    // Their situation changed: now it is an interview.
    await user.click(screen.getByRole('radio', { name: /Interview prep/ }))
    const goal = screen.getByLabelText(/Goal, in your words/)
    await user.clear(goal)
    await user.type(goal, 'Backend role at a fintech')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(me.updateStudentModel).toHaveBeenCalledWith({
        study_mode: 'interview',
        exam_context: 'Backend role at a fintech',
        exam_date: null,
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })
})
