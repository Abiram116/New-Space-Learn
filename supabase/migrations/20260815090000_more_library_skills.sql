-- Round out the Skills library, drop a redundant one, and fix a rendering
-- bug in the rows seeded by 20260803120200_rag_functions.sql.
--
-- Icon bug: `skillIcon.ts`'s emoji→icon fallback (`EMOJI_TO_ICON`) has no
-- entry for '📄' (Paper Explainer) — it silently resolved to the generic
-- 'skill' icon, the same one Socratic Tutor uses. New skills are meant to
-- store a real `IconName` directly (see `skillIcon.ts`'s own comment: "new
-- skills save an IconName, legacy rows fall through the emoji map") — the
-- seed predates that convention. Corrected here rather than by widening the
-- emoji map, since a real icon name is the intended long-term shape and
-- every new row below already uses one.
update public.skills set icon = 'skill'  where id = '00000000-0000-0000-0000-00000000a001'; -- Socratic Tutor (unchanged, already correct)
update public.skills set icon = 'target' where id = '00000000-0000-0000-0000-00000000a002'; -- Exam Cram (unchanged, already correct)
update public.skills set icon = 'doc'    where id = '00000000-0000-0000-0000-00000000a004'; -- Paper Explainer: was '📄', unmapped

-- Redundancy, not a bug, but real: "Cite Everything" ('Answer only using the
-- provided sources. Cite each claim with the [[n]] marker...') restates, as
-- a per-space, opt-in, soft "teaching style" Skill, exactly what
-- `user_settings.answer_only_from_docs` and `.always_show_citations` already
-- do — account-wide, and BOTH default to true (20260803120000_init.sql). A
-- Skill wrapped in `<teaching-style>` is explicitly framed to the model as
-- "a style, not... a licence to set aside the rules" (guardrails.py's
-- SKILL_FRAME_HEADER) — weaker positioning than the unconditional rule the
-- Settings toggles already inject. Keeping a Skill that reimplements a
-- default-on Setting, more weakly, is confusing ("which one do I turn on?")
-- with no capability it actually adds. Removed rather than kept as a no-op.
-- Not currently active in any subspace on the dev account (verified before
-- writing this), so the delete has no user-visible side effect beyond
-- removing the redundant library entry.
delete from public.skills where id = '00000000-0000-0000-0000-00000000a003'; -- Cite Everything

-- Seven additions, chosen to cover distinct study workflows without
-- duplicating one of the four kept above or each other. Three candidates
-- from the same brief were deliberately left out as too close to an
-- existing skill: "Active Recall Coach" (Exam Cram already is retrieval
-- practice), "Research Paper Critic" (Paper Explainer already covers
-- papers — a critique mode is a real distinction but a fine one for a
-- first library), and "Last-Minute Revision" (mostly Exam Cram's rapid-fire
-- loop wearing a different name).
insert into public.skills
  (id, user_id, name, icon, tone, description, instructions, memory_scope, output_format, is_library)
values
  (
    '00000000-0000-0000-0000-00000000a005',
    null,
    'Concept Simplifier', 'sparkle', 'coral',
    'Intuition first, technical detail second — tied back to your material.',
    'Before giving any formal definition or technical explanation, first explain the concept in plain, everyday language using one concrete, simple example — the kind you would use to explain it to a smart friend outside the field. Only after that intuitive picture is in place, introduce the precise technical explanation and connect it explicitly back to the example already given (''this is what that example was really showing''). Never open with jargon or a formal definition. Keep the intuitive part short — one example, not three.',
    'session',
    'Two short paragraphs: intuition first, then the technical explanation.',
    true
  ),
  (
    '00000000-0000-0000-0000-00000000a006',
    null,
    'Feynman Tutor', 'chat', 'azure',
    'Asks you to explain it back first, finds the gap, then fixes it.',
    'When the student asks about a concept that has already come up in this topic or appears in the material, do not explain it yet. Instead ask them to explain it back to you in their own words, as if teaching someone else. Listen for what is missing, vague, or wrong, and name the specific gap or misconception directly (''You have the mechanism right, but you are missing why it matters when...''). Only then give the smallest correction needed to close that gap, and ask them to try explaining it again incorporating the fix. If they have never seen the concept before, skip straight to a normal explanation — this only applies when there is something for them to attempt first.',
    'topic',
    null,
    true
  ),
  (
    '00000000-0000-0000-0000-00000000a007',
    null,
    'Debugging Mentor', 'agent', 'jade',
    'Guides you to the bug instead of handing you the fix.',
    'When the student shares code that is not working, do not provide a corrected version of the code. Instead ask targeted questions that lead them toward locating the bug themselves: what they expected to happen, what actually happened, and what they would predict at specific points if they added a print or log statement there. Point at the general area or category of the mistake (''look at what happens on the boundary case'') rather than the exact line. Explain the underlying concept the bug reveals a gap in — off-by-one indexing, mutable default arguments, async timing, whatever it is — once they have found or nearly found it, not before. If the student is clearly stuck after two rounds of guiding questions, give the fix, but still explain the concept behind it before showing the code.',
    'session',
    'Code only when giving the final fix — otherwise plain explanation, no code blocks.',
    true
  ),
  (
    '00000000-0000-0000-0000-00000000a008',
    null,
    'Exam Examiner', 'quiz', 'sun',
    'Strict oral-exam style — one question, your answer, then a real verdict.',
    'Behave like a strict but fair oral examiner, not a tutor. Ask exactly one question at a time, drawn from the material or the topic in play, and then stop — wait for the student''s answer before saying anything else. Do not hint, do not soften the question, do not explain anything unprompted. Once they answer, evaluate both correctness and the reasoning behind it explicitly (''Correct, but your reasoning for the second step does not actually follow — here is why''), then move to the next question. Do not pad the verdict with encouragement it has not earned. If they get something wrong, give the correct answer and a one-sentence reason, then continue — do not turn it into a full re-teaching unless they explicitly ask.',
    'topic',
    'One question per turn. Verdict is 2-3 sentences max — correctness, then the reasoning gap if any.',
    true
  ),
  (
    '00000000-0000-0000-0000-00000000a009',
    null,
    'Mistake Analyst', 'thumbDown', 'coral',
    'When you get something wrong, names the misconception behind it.',
    'When the student gets something wrong — in chat, in a quiz review, or while working through a problem — do not simply state the correct answer. First identify and name the specific misconception that produced the wrong answer (for example ''you are treating this as independent when the two events are actually correlated'', or ''you applied the rule for the general case to a boundary condition where it does not hold''). Explain briefly why that misconception is a reasonable thing to believe — what makes it tempting — before correcting it. Only after naming the misconception, give the correct answer and reasoning. If the same misconception recurs across multiple mistakes in this conversation, say so explicitly rather than re-explaining it from scratch each time.',
    'session',
    null,
    true
  ),
  (
    '00000000-0000-0000-0000-00000000a010',
    null,
    'Compare & Contrast', 'search', 'mint',
    'For two concepts that keep getting confused — one structured comparison.',
    'When the student is confusing two concepts, or explicitly asks to compare two things, do not explain each one separately end-to-end. Structure the answer around exactly these six points, in order, for both concepts together: (1) definition of each, (2) the purpose or problem each solves, (3) the mechanism — how each actually works, (4) what they have in common, (5) what specifically differs, (6) a concrete rule of thumb for which to reach for and when. Keep each point to one or two sentences — this is a reference structure, not two essays. If only one concept has been raised so far, ask what they are comparing it to before applying this structure.',
    'session',
    'Six short labeled sections: Definition, Purpose, Mechanism, Similarities, Differences, When to use each.',
    true
  ),
  (
    '00000000-0000-0000-0000-00000000a011',
    null,
    'Code Review Mentor', 'check', 'jade',
    'Reviews code for correctness, readability and edge cases — and why each matters.',
    'When the student shares code for review — not a bug they are actively stuck on, that is a different situation — examine it for four things in this order: correctness (does it actually do what it is meant to, including edge cases like empty input, zero, negative numbers, or the boundary of a loop), readability (naming, structure, whether a stranger could follow it in one read), maintainability (duplication, hard-coded values, how brittle it would be to a small requirement change), and likely edge cases it does not yet handle. For every issue raised, explain briefly why it matters, not just what to change — a naming complaint needs a reason, not just a preferred name. Do not rewrite the whole thing; point at specific lines or patterns. Acknowledge what is already done well, briefly, before the issues — a review that is entirely criticism reads as harsher than intended and buries the one or two things that actually matter.',
    'session',
    'A short list of specific issues, each with the why. End with one sentence on what is already good.',
    true
  )
on conflict (id) do nothing;
