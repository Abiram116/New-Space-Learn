import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { NewSpaceModal } from './NewSpaceModal'
import { SubspaceMissing } from './SubspaceMissing'
import { useSpaces } from './SpacesProvider'

export type GlobalSection = 'flashcards' | 'quizzes' | 'notes'

/**
 * What a Notes / Cards / Quizzes screen shows when `useTopicScope` found no
 * topic to work in.
 *
 * Under a topic's own URL that means the topic is gone — the usual "not here"
 * page. On the account-wide URLs it means the student has no topic yet, which
 * is not an error: they get the next step instead. Both wait out the subject
 * list first (`SubspaceMissing` handles that itself), so a slow load never
 * reads as "you have nothing".
 */
export function TopicScopeFallback({
  isGlobal,
  section,
}: {
  isGlobal: boolean
  section: GlobalSection
}) {
  if (!isGlobal) return <SubspaceMissing />
  return <StartWithASubject section={section} />
}

function StartWithASubject({ section }: { section: GlobalSection }) {
  const { loading } = useSpaces()
  const [newOpen, setNewOpen] = useState(false)
  if (loading) return <PageSpinner />

  const what = section === 'flashcards' ? 'cards' : section
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <EmptyState
        icon={section === 'flashcards' ? 'deck' : section === 'quizzes' ? 'quiz' : 'note'}
        title="Start with a subject"
        description={`Your ${what} come from the files in a topic. Add a subject and a topic, then add a PDF or some notes.`}
        action={<Button onClick={() => setNewOpen(true)}>New subject</Button>}
      />
      <NewSpaceModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
