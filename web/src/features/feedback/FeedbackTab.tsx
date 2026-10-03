import { FeedbackForm } from './FeedbackForm'

/** Settings › Feedback: the form. Reading what people sent is not part of any
 *  account — it lives on its own locked page (features/admin). */
export function FeedbackTab() {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="mb-6 text-[14px] text-muted">
        A few quick questions, then room to say anything. It goes straight to the two of us.
      </p>
      <FeedbackForm source="settings" />
    </div>
  )
}
