import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { useSpaces } from './SpacesProvider'

/**
 * Shown by every subspace-scoped view when the URL points at something we
 * can't find.
 *
 * "Can't find" and "haven't loaded yet" are NOT the same thing, and conflating
 * them is what made a perfectly valid topic report itself as deleted.
 * `useActiveSubspace` resolves against the spaces list, which is null until
 * `/spaces` returns — and that request currently takes seconds — so every view
 * rendered "This topic isn't here. It may have been renamed or deleted" during
 * the wait, then silently swapped to the real content.
 *
 * Telling someone their work is gone while it is still loading is the worst
 * possible failure mode for a study app, so the loading case gets a spinner
 * and only a genuinely unresolvable id gets the message.
 */
export function SubspaceMissing() {
  const { loading } = useSpaces()

  // ONLY the in-flight fetch spins. An earlier version also spun on
  // `spaces.length === 0`, which is wrong in both directions: a user with no
  // subjects at all would spin forever, and a signed-out or failed request
  // would too. `loading` is the only thing that actually means "we do not
  // know yet".
  if (loading) return <PageSpinner />

  return (
    <div className="p-6">
      <EmptyState
        icon="target"
        title="This topic isn't here"
        description="It may have been renamed or deleted. Pick another space from the sidebar."
        // `text-white` on the brand background used to be hand-rolled here
        // (~3.1:1 contrast, fails WCAG AA) instead of going through `Button`,
        // whose `primary` variant every other brand-colored control uses.
        action={
          <Link to="/home">
            <Button>Back home</Button>
          </Link>
        }
      />
    </div>
  )
}
