/**
 * What the API will accept, mirrored so an input can stop before it 422s.
 *
 * **Why this file exists.** Onboarding shipped a multi-select that joined its
 * picks into a field capped at 60 characters server-side. Two picks made ~75,
 * the PATCH failed validation, and because the intake sends one patch the
 * student's session length and teaching preference were discarded along with
 * it — silently, behind a full-screen transition. The lesson was not "cap that
 * one field". It was that a limit known only to the server is a limit the UI
 * will eventually walk into.
 *
 * An audit found the same shape almost everywhere: of roughly twenty text
 * inputs in the app, three capped their length. A student pasting a long
 * passage into chat, naming a subject verbosely, or writing a detailed prompt
 * got a raw validation error for input the UI had actively invited them to
 * type.
 *
 * **Why one module rather than a number on each input.** Twenty `maxLength`
 * attributes is twenty places for the client and the server to disagree — the
 * exact defect being fixed, reintroduced in a new shape. These constants are
 * checked against `api/app/schemas/__init__.py` by `tests/limits.test.ts`, so
 * changing a `Field(max_length=...)` without changing this file fails the
 * build rather than a student's request.
 *
 * Keep every value identical to its schema field. This is a mirror, not a
 * policy: a client that stops *earlier* than the server is a input someone
 * cannot finish typing for reasons the UI never explains.
 */

export const LIMITS = {
  /** `ChatSend.text` — one message. Reachable by pasting a long passage. */
  chatText: 4000,
  /**
   * `ChatSend.images` — how many attachments, not how long a string.
   *
   * The odd one out in this file, and it earns its place: the count was
   * hardcoded twice in the attachment UI, which is the duplication this
   * module exists to remove. The vision model also degrades sharply past a
   * few images, so this is a quality ceiling as much as a payload one.
   */
  chatImages: 3,

  /** `SpaceCreate.name` / `SpaceUpdate.name` — a subject. */
  spaceName: 80,
  /** `SubspaceCreate.name` / `SubspaceUpdate.name` — a topic. */
  subspaceName: 80,
  /** `DeckCreate.name`. */
  deckName: 80,

  /** `NoteCreate.title` / `NoteUpdate.title`. */
  noteTitle: 140,
  /** `NoteGenerate.instructions` — "how should this note be written". */
  noteInstructions: 500,
  /** `NoteGenerate.topic`. */
  noteTopic: 140,
  /** `NoteAiInline.prompt` — shared by the typed `/ai` box and the
   *  selection actions (Rewrite, Simplify, …), which wrap a selected
   *  passage inside instruction boilerplate before sending it through this
   *  same field — sized for that, not just a short typed line. */
  notePrompt: 4000,

  /**
   * `CardsGenerate.topic` — "generate a deck about…".
   *
   * The audit's coverage check first had this on the skip list as "preset by
   * the caller". It isn't: the generate modal offers it as a free-text box.
   * That mistake is the reason the check lists exclusions explicitly instead
   * of pattern-matching field names — a wrong skip is invisible, and this one
   * was only caught by walking the modal.
   */
  cardsTopic: 120,

  /** `FlashcardCreate.front` / `FlashcardUpdate.front`. */
  cardFront: 500,
  /** `FlashcardCreate.back` / `FlashcardUpdate.back`. Reachable by pasting. */
  cardBack: 2000,

  /** `QuizGenerate.topic` — "generate a quiz about…". Typed in two places:
   *  the quiz modal, and the `/quiz <topic>` slash command's argument. */
  quizTopic: 140,

  /** `SkillCreate.instructions` / `SkillUpdate.instructions`. */
  skillInstructions: 4000,
  /** `SkillCreate.name` / `SkillUpdate.name`. */
  skillName: 80,
  /** `SkillCreate.output_format` / `SkillUpdate.output_format`. */
  skillOutputFormat: 300,

  /** `StudentModelIn.learning_style` — the joined multi-select. */
  learningStyle: 240,
  /** `StudentModelIn.teaching_preference`. */
  teachingPreference: 400,
  /** `StudentModelIn.exam_context`. */
  examContext: 140,
} as const

export type LimitName = keyof typeof LIMITS
