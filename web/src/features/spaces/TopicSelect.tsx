/**
 * "Which topic does this go in?" — for the things that live in a topic but are
 * listed across all of them (decks, quizzes).
 *
 * Cards used to quietly use whichever topic you last had open, so the page
 * looked global while creation was not. This makes the target visible and
 * changeable. It renders nothing when there is only one topic to choose from.
 */

import { Select } from '../../components/ui/Select'
import { useSpaces } from './SpacesProvider'

export function TopicSelect({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (topicId: string) => void
  className?: string
}) {
  const { spaces } = useSpaces()
  const options = spaces.flatMap((space) =>
    space.subspaces.map((sub) => ({ value: sub.id, label: `${space.name} › ${sub.name}` })),
  )
  if (options.length < 2) return null
  return (
    <div className={className}>
      <span className="setcode mb-1.5 block">Topic</span>
      <Select value={value} onChange={onChange} options={options} ariaLabel="Topic" />
    </div>
  )
}

/** The topic's name for a placeholder, or an empty string when unknown. */
export function useTopicName(topicId: string): string {
  const { spaces } = useSpaces()
  for (const space of spaces) {
    const sub = space.subspaces.find((s) => s.id === topicId)
    if (sub) return sub.name
  }
  return ''
}
