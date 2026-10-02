import { useEffect, useState } from 'react'
import { amIAdmin } from '../../api/productFeedback'
import { FeedbackAdmin } from './FeedbackAdmin'
import { FeedbackForm } from './FeedbackForm'

/**
 * Settings › Feedback: the form for everyone, and — for the two admins — the
 * tools to change its questions and read the responses.
 */
export function FeedbackTab() {
  const [admin, setAdmin] = useState(false)
  useEffect(() => {
    // A hint for what to show; the server decides what an account may do.
    amIAdmin()
      .then((r) => setAdmin(r.admin))
      .catch(() => setAdmin(false))
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-line bg-surface p-5">
        <p className="mb-6 text-[14px] text-muted">
          A few quick questions, then room to say anything. It goes straight to the two of us.
        </p>
        <FeedbackForm source="settings" />
      </div>
      {admin && <FeedbackAdmin />}
    </div>
  )
}
