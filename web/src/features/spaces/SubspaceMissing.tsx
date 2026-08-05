import { Link } from 'react-router-dom'
import { EmptyState } from '../../components/ui/EmptyState'

/** Shown by every subspace-scoped view when the URL points at something we
 *  can't find (deleted, wrong id, or the user hasn't finished loading). */
export function SubspaceMissing() {
  return (
    <div className="p-6">
      <EmptyState
        icon="target"
        title="This topic isn't here"
        description="It may have been renamed or deleted. Pick another space from the sidebar."
        action={
          <Link
            to="/home"
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            Back home
          </Link>
        }
      />
    </div>
  )
}
