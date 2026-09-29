/**
 * Celebrations and study ambience.
 *
 *   celebrate(occasion, { facts, anchor, bar, compact })  — one moment
 *   <StudyAmbience> / useAmbience()                       — the room a session sits in
 *   useStudySession(), noteCardGraded(), celebrateQuiz()  — goal, streak, personal best
 */
export { celebrate, preloadCelebrations, type CelebrateOptions } from './celebrate'
export { AmbienceField, StudyAmbience } from './Ambience'
export { useAmbience, useAmbienceField, type Pulse } from './useAmbience'
export { celebrateQuiz, checkStreak, noteCardGraded, useStudySession } from './session'
