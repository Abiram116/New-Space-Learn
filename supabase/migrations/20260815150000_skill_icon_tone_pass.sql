-- Visual refinement pass on the Skills library: icon and tone reassignment
-- only. No schema, activation, memory, or prompt-logic change.
--
-- Before this: six of the ten library rows either shared an icon with
-- another skill (Socratic Tutor's 'skill' is also the generic fallback
-- `resolveSkillIcon` uses for anything unrecognised — see skillIcon.ts) or
-- used one that didn't fit what the skill actually does (Mistake Analyst's
-- 'thumbDown' reads as "downvote", not "here is the misconception"; Exam
-- Cram's 'target' says "aim", not "timed"). Tones collided by accident, not
-- by design: Concept Simplifier and Mistake Analyst both landed on 'coral',
-- Exam Cram and Compare & Contrast both on 'mint', Debugging Mentor and Code
-- Review Mentor both on 'jade' — three unrelated pairs of skills rendering
-- as the exact same colour with no reason for the overlap.
--
-- Every icon below is now unique across the ten rows (see the regression
-- test in skillIcon.test.ts's sibling coverage). Tones are still shared in
-- three places, but deliberately: Socratic Tutor and Feynman Tutor (both
-- explanation-through-dialogue) share 'sky' — the app's existing
-- source/evidence tone (see index.css's "Accents read as roles" comment);
-- Exam Examiner and Exam Cram (both exam-prep) share 'sun' — the app's
-- existing recall/due tone; Debugging Mentor and Code Review Mentor (both
-- code-focused) share 'jade'. Every other skill got its own tone. No new
-- colour was added — index.css states the palette is "no violet, dark-only
-- by design", so the fix stays inside the seven tones that already exist
-- rather than widening `skills_tone_check`.
update public.skills set icon = 'chat',   tone = 'sky'   where id = '00000000-0000-0000-0000-00000000a001'; -- Socratic Tutor: was 'skill'/'brand'
update public.skills set icon = 'clock',  tone = 'sun'   where id = '00000000-0000-0000-0000-00000000a002'; -- Exam Cram: was 'target'/'mint'
update public.skills set              tone = 'azure' where id = '00000000-0000-0000-0000-00000000a004'; -- Paper Explainer: icon 'doc' already fits; was tone 'sky'
update public.skills set              tone = 'brand' where id = '00000000-0000-0000-0000-00000000a005'; -- Concept Simplifier: icon 'sparkle' already fits; was tone 'coral'
update public.skills set icon = 'quote', tone = 'sky' where id = '00000000-0000-0000-0000-00000000a006'; -- Feynman Tutor: was 'chat' (now Socratic Tutor's) / 'azure'; paired with Socratic Tutor on 'sky'
update public.skills set icon = 'alert'               where id = '00000000-0000-0000-0000-00000000a009'; -- Mistake Analyst: was 'thumbDown'; tone 'coral' unchanged
