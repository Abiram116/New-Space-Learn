/**
 * The lists Home reads beyond `/spaces` and `/me/stats`, each under the cache
 * key the rest of the app already uses ('quizzes:all', 'decks:all',
 * 'student-model'), so Home, Profile, Cards and Quizzes share one copy.
 *
 * A list is only asked for when the subject counts say it can hold something:
 * an account with no quizzes never requests the quiz list. A skipped list is
 * fetched without a key, so it never writes an empty answer into the shared
 * cache for another screen to trust.
 */

import { useMemo } from 'react'
import { listAllDecks } from '../../api/flashcards'
import { getStudentModel } from '../../api/me'
import { listAllQuizzes } from '../../api/quizzes'
import type { Quiz, Space, StudentModel } from '../../api/types'
import { useAsync } from '../../lib/useAsync'
import { pickRetake, topicLinkFor } from './today'
import { indexTopics, type TopicIndex } from './week'

export type HomeData = {
  index: TopicIndex
  retake: { quiz: Quiz; href: string } | null
  retakeLoading: boolean
  model: StudentModel | null
  modelLoading: boolean
  decksLoading: boolean
}

const skip = () => Promise.resolve(null)

export function useHomeData(spaces: Space[]): HomeData {
  const subs = spaces.flatMap((s) => s.subspaces)
  const anyQuizzes = subs.some((s) => (s.counts?.quizzes ?? 0) > 0)
  const anyCards = subs.some((s) => (s.counts?.cards ?? 0) > 0)
  const anyWork = anyQuizzes || anyCards

  const quizzes = useAsync<Quiz[] | null>(anyQuizzes ? listAllQuizzes : skip, [anyQuizzes], anyQuizzes ? 'quizzes:all' : undefined)
  const decks = useAsync(anyCards ? listAllDecks : skip, [anyCards], anyCards ? 'decks:all' : undefined)
  const student = useAsync<StudentModel | null>(anyWork ? getStudentModel : skip, [anyWork], anyWork ? 'student-model' : undefined)

  const index = useMemo(() => indexTopics(spaces, quizzes.data, decks.data), [spaces, quizzes.data, decks.data])
  const retake = useMemo(() => {
    const quiz = pickRetake(quizzes.data)
    const base = quiz ? topicLinkFor(spaces, quiz.subspace_id) : null
    return quiz && base ? { quiz, href: `${base}/quizzes?q=${encodeURIComponent(quiz.id)}` } : null
  }, [quizzes.data, spaces])

  return {
    index,
    retake,
    retakeLoading: anyQuizzes && quizzes.loading && !quizzes.data,
    model: student.data ?? null,
    modelLoading: anyWork && student.loading && !student.data,
    decksLoading: anyCards && decks.loading && !decks.data,
  }
}
