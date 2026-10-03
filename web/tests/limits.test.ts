/**
 * The client's idea of a length limit must equal the server's.
 *
 * This is the test the onboarding bug needed. A multi-select joined its picks
 * into a field capped at 60 characters server-side; two picks made ~75; the
 * PATCH 422'd; and because the intake sends one patch, the session length and
 * teaching preference were discarded with it. Nothing failed loudly — the
 * error surfaced as a toast behind a full-screen transition and onboarding
 * carried on to the dashboard as though it had worked.
 *
 * An audit found the same shape nearly everywhere: three of roughly twenty
 * text inputs capped their length. So `lib/limits.ts` mirrors the schema, and
 * this reads the actual Python to check the mirror is true.
 *
 * Reading the other language's source is unusual and deliberate. A shared
 * fixture would prove the two agree with each other while both drifted from
 * the thing that actually validates the request. The Pydantic field IS the
 * contract, so the Pydantic field is what gets parsed.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LIMITS } from '../src/lib/limits.js'

const API_SCHEMA = resolve(__dirname, '../../api/app/schemas/__init__.py')

/**
 * `max_length` / `ge` / `le` for every `Class.field` in the schema module.
 *
 * A deliberately small parser rather than a Python import: this runs in the
 * frontend suite, where there is no interpreter, and the alternative — a
 * generated artefact — is one more thing that can be stale.
 */
function parseSchema(): Map<string, number> {
  const text = readFileSync(API_SCHEMA, 'utf8')
  const found = new Map<string, number>()
  let cls: string | null = null
  for (const line of text.split('\n')) {
    const c = /^class (\w+)\(BaseModel\)/.exec(line)
    if (c) {
      cls = c[1]
      continue
    }
    const f = /^ {4}(\w+):\s*.+?=\s*Field\((.*)\)\s*$/.exec(line)
    if (!f || !cls) continue
    const max = /max_length=(\d+)/.exec(f[2])
    if (max) found.set(`${cls}.${f[1]}`, Number(max[1]))
  }
  return found
}

const SCHEMA = parseSchema()

/** Every client limit, and the schema field it claims to mirror. */
const MIRRORS: [keyof typeof LIMITS, string[]][] = [
  ['chatText', ['ChatSend.text']],
  // A list-length cap rather than a string cap, but the same drift risk.
  ['chatImages', ['ChatSend.images']],
  ['spaceName', ['SpaceCreate.name', 'SpaceUpdate.name']],
  ['subspaceName', ['SubspaceCreate.name', 'SubspaceUpdate.name']],
  ['deckName', ['DeckCreate.name']],
  ['noteTitle', ['NoteCreate.title', 'NoteUpdate.title']],
  ['noteInstructions', ['NoteGenerate.instructions']],
  ['noteTopic', ['NoteGenerate.topic']],
  ['notePrompt', ['NoteAiInline.prompt']],
  ['cardsTopic', ['CardsGenerate.topic']],
  ['cardFront', ['FlashcardCreate.front', 'FlashcardUpdate.front']],
  ['cardBack', ['FlashcardCreate.back', 'FlashcardUpdate.back']],
  ['quizTopic', ['QuizGenerate.topic']],
  ['skillInstructions', ['SkillCreate.instructions', 'SkillUpdate.instructions']],
  ['skillName', ['SkillCreate.name', 'SkillUpdate.name']],
  ['skillOutputFormat', ['SkillCreate.output_format', 'SkillUpdate.output_format']],
  ['learningStyle', ['StudentModelIn.learning_style']],
  ['teachingPreference', ['StudentModelIn.teaching_preference']],
  ['examContext', ['StudentModelIn.exam_context']],
  ['feedbackPrompt', ['FeedbackQuestionCreate.prompt', 'FeedbackQuestionUpdate.prompt']],
  ['feedbackEmail', ['ProductFeedbackIn.contact_email']],
  ['adminPassword', ['AdminUnlockIn.password']],
  ['feedbackDetail', ['FeedbackAnswerIn.detail']],
]

describe('client limits mirror the API schema', () => {
  it('parsed something — a silent zero would pass every test below', () => {
    expect(SCHEMA.size).toBeGreaterThan(15)
  })

  it.each(MIRRORS)('%s matches the schema', (name, fields) => {
    for (const field of fields) {
      const schemaValue = SCHEMA.get(field)
      expect(schemaValue, `${field} is not in the schema — was it renamed?`).toBeDefined()
      expect(LIMITS[name], `${String(name)} disagrees with ${field}`).toBe(schemaValue)
    }
  })

  it('covers every create/update field the API constrains', () => {
    /**
     * Catches the *other* direction: a new capped field added to the API that
     * no input mirrors. Read-only and internal shapes are excluded — the
     * concern is fields a person types into.
     */
    const mirrored = new Set(MIRRORS.flatMap(([, fields]) => fields))
    const skip = new Set([
      'FeedbackIn.kind', //     chosen from a fixed set, never typed
      'FeedbackIn.concept', //  derived from the answer, never typed
      // `CardsGenerate.topic` was on this list, described as preset by the
      // caller. It is a free-text box in the generate modal. A wrong skip is
      // the one failure this check cannot report, so each line below was
      // confirmed against the component that sends the field.
      'CardsGenerate.deck_name', // derived from the topic, never typed
      'CardsGenerate.source_text', // a chat reply, already bounded
      'NoteAiInline.note_text', // the note's own body, sliced before sending
      'GradeIn.review_id', //   a one-time id generated by gradeCard, never typed
      'FeedbackReorder.ids', // a list of ids, built by the admin screen
      'FeedbackAnswerIn.question_id', // an id from the form, never typed
      'ProductFeedbackIn.answers', // a count of answers, not a string length
      'ProductFeedbackIn.page', // the current address, sliced before sending
      'ProductFeedbackIn.website', // the bot trap; no person types in it
    ])
    const unmirrored = [...SCHEMA.keys()].filter((k) => !mirrored.has(k) && !skip.has(k))
    expect(unmirrored).toEqual([])
  })
})

describe('feedback answer limits mirror the API constants', () => {
  const text = readFileSync(API_SCHEMA, 'utf8')
  const constant = (name: string) => Number(new RegExp(`^${name} = (\\d+)`, 'm').exec(text)?.[1])

  it.each([
    ['feedbackShort', 'FEEDBACK_SHORT_MAX'],
    ['feedbackLong', 'FEEDBACK_LONG_MAX'],
    ['feedbackOption', 'FEEDBACK_OPTION_MAX'],
  ] as const)('%s matches %s', (name, pyName) => {
    expect(constant(pyName)).toBeGreaterThan(0)
    expect(LIMITS[name]).toBe(constant(pyName))
  })
})

