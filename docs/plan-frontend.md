# Plan — Frontend

**Status: §1–§13 are built and shipped** (2026-08-05). §14–§16 remain open.
Ordered by priority, not by size. Each epic notes its backend dependency
(if any) — see [plan-backend.md](plan-backend.md) for the matching
backend-side work; epics are named the same on both sides so they line up.

Context for why this list looks the way it does: [v2-review.md](v2-review.md).
Read [vision.md](vision.md) first — everything below is judged against it.

## What's still open

| # | Item | Why it's still open |
|---|---|---|
| §14 | Toast contrast | Small CSS fix, not yet done. |
| §15 | Landing hero font race + marquee loop gap | Diagnosed, not yet fixed. |
| §16 | Cinematic Higgsfield pass | Deliberately its own session — asset generation, not code. |

Also deferred inside otherwise-shipped epics: composer paste-as-attachment
and paste-image-into-chat (§9 shipped CSV/image *document* ingestion and the
dock drop zone, not the composer chip UI), and aggregate weak-topic
analytics (§13 ships per-question `subtopic` tagging; the cross-attempt
rollup waits until there's real tagged data to aggregate).

## Cross-cutting — Voice & Identity

Not a standalone feature — a copy/tone guideline that epics §1 (Home
brief), §2 (agents), and §3 (Student Model) all need to actually follow,
called out separately because it's easy to build the data-correct version
of each epic and still have it read like a form. The bar, from
`vision.md`'s examples: every AI-authored sentence should sound like it
comes from the same consistent mentor voice, and should be specific to
*this* student's real stored history — never generic filler ("Great job!",
"Keep it up!") standing in for an actual observation. Concretely:
- One short tone/voice reference doc (a handful of good/bad example lines,
  not a style guide) that the Home brief, agent-launch copy, and any future
  chat-opening lines get written against.
- Greeting/opening lines vary by real context (time since last session,
  what was last studied) rather than reusing the same template sentence
  with different nouns substituted in.
- This is copywriting and prompt-construction work, not a UI component —
  touches the text produced by §1/§2/§3, not new screens.
**Backend dependency:** `plan-backend.md`'s equivalent cross-cutting note —
the actual system-prompt text lives server-side.

## P0 — highest priority

### 1. Home brief as a recommendation engine
Extend the Home hero from a single re-entry line into an actual opening
move: name a weak area, suggest one concrete next action (retake this quiz,
review this deck, generate a fresh set), with a single button that starts
it. Still governed by the existing no-invented-numbers guard — the
suggestion has to be computable from real stored data or it doesn't ship.
**Backend dependency:** `plan-backend.md` §1 (extend `/me/brief` response
shape with a `suggestion` field).

### 2. Context-aware agents
The Notes/Cards/Quiz agent launchers in `ContextDock.tsx` currently pass a
bare topic or the last reply. Change the launch flow so agents show what
they already know before asking anything ("You've been discussing
cross-attention — generate cards on that?") instead of opening a blank
form. Removes fields the agent can infer from context; keeps only what it
genuinely can't know (e.g. card count).
**Backend dependency:** `plan-backend.md` §2 (agents receive real session
context server-side, not just a topic string).

### 3. Student Model
Elevated from a single preference field after two independent reviews
(this plan's own retrospective, and the external review in `v2-review.md`)
converged on personalization/memory as the single biggest opportunity — the
richer version turned out to be mostly data you already store, not new
infrastructure. A profile view (in Settings, and summarized on Home)
showing: explicit fields the student sets directly (learning style
preference, session length, current exam/deadline context) plus computed
fields the app already has the data for (weak areas from real quiz
averages, strong areas the same way, current streak/pace) — never an
inferred field presented as fact if it isn't actually computed from
something stored. Every explicit and computed field gets injected into
chat/agent/brief prompts. Ship the explicit fields and the computed
weak/strong areas together — both are buildable now; a longer-run
behavioral-inference tier (learning style inferred from usage patterns
rather than self-reported) stays a distinct, later phase.
**Backend dependency:** `plan-backend.md` §3.

## P1

### 4. Linked Subspaces
Replaces the open-ended "cross-context knowledge" backlog item with a
scoped alternative to a full knowledge graph (see `v2-review.md` for why
the graph rearchitecture is rejected). Two frontend surfaces:
- A "related to" picker on a subspace's settings, letting a student
  explicitly link it to another subspace (same subject or a different
  one).
- When creating a subspace from a freshly uploaded document with no name
  chosen yet, show the AI-suggested name as a pre-filled, editable
  suggestion rather than a blank required field.
**Backend dependency:** `plan-backend.md` §4.

### 5. Skills as a behavior package
Skill creation/edit UI grows from a single instructions textarea into
distinct fields: reasoning style, memory scope, output format, allowed
tools — each with a short explanation of what it does, not just labeled
inputs. `SkillsView.tsx` card display should surface the behavior summary,
not just the name/icon.
**Backend dependency:** `plan-backend.md` §5 (schema change).

### 6. LLM grounding fix — quiz/flashcard generation
Already-diagnosed bug (backlog: "transformers" generated movie trivia, not
attention-mechanism questions) — the generation modal needs to make clear
what subject/subspace context is being used, and show a real empty state
("nothing indexed on this topic yet") instead of silently letting the model
free-associate.
**Backend dependency:** `plan-backend.md` §6.

### 7. Layout — wide-screen space usage
Quiz-taking, quiz results, quiz list scrolling, flashcard review, and the
Notes editor all currently center content in a narrow column. Redesign each
to use the full width deliberately (per the "no rules, bold design" brief
already on record) — not by stretching the same narrow card wider, but by
giving each screen a real wide-format layout (e.g. quiz results: question
review list running alongside a summary panel, not stacked under it).
Flashcard grade buttons ("easy/hard doesn't feel good") need an actual
interaction redesign as part of this pass, not a spacing tweak.
**Backend dependency:** none — pure frontend.

## P2

### 8. Settings — real actions
Change-password (Supabase client SDK handles this directly with the
current session) and delete-account (calls one backend endpoint) as real
actions, not a flat list of inert rows. Needs a confirmation flow for
delete given it's irreversible.
**Backend dependency:** `plan-backend.md` §7 (delete-account endpoint).

### 9. Composer / multimodal input
Pasting a large text block collapses into an attachment chip instead of
dumping raw text into the textarea. Pasting an image attaches it. The
context dock's upload box gets real drag-and-drop instead of linking out to
the Docs page.
**Backend dependency:** `plan-backend.md` §8 (image + CSV upload support).

### 10. Notes — rich editor + inline AI
The largest single item on this list — effectively building a small editor,
not a UI pass. Confirmed against a live screenshot (2026-08-05) of a
Notes-agent note, which surfaced the current implementation's real problems
concretely, not just abstractly:

- **It renders as a small boxed, scrollable panel floating in empty space**
  — not a full notepad page. This is the same "utilize the whole space"
  complaint as §7, applied specifically to Notes: no rules, full width and
  height, feels like a page, not a widget.
- **Raw markdown leaks to the screen as literal characters** — `**bold**`
  shows up as literal asterisks, not bold text. This is a rendering bug,
  not a content bug: the fix is real WYSIWYG rendering (or an actual
  rich-text data model instead of a markdown string), never raw `**`/`__`/
  `#` reaching the screen. Same family of bug as the earlier `iconFor()`
  half-migration mistake in `retrospective.md` — a format changed and a
  render path wasn't updated to match.
- **One editor, two authors, not two separate flows.** The mental model to
  build toward: the Notes page is a single notepad a student writes in
  directly *and* where the AI writes for them — not "AI reply gets copied
  into a box" (the old behavior) and not "AI note is a separate read-only
  artifact" either. A note the AI wrote must be exactly as editable as one
  the student typed themselves — same editor, same toolbar, no special-
  cased origin in the UI.
- **`/ai <prompt>` works inline, on any note, at any point while writing**
  — not only as a separate "generate a note" agent action. AI assistance
  is a tool available *inside* the act of writing, the same note the
  student is already in, writing in place where the cursor is.
- **A real formatting toolbar**, not just inline markdown shortcuts: bold,
  italic, underline, strikethrough, bulleted list, numbered list, at
  minimum. Mermaid-based diagram generation (`/ai diagram of ...`) remains
  a natural later extension of the same `/ai` command once the base editor
  exists, not a separate feature.

**Open decision to make before starting:** hand-roll a `contentEditable`
editor (smaller, matches the bespoke visual system, more to maintain) vs.
adopt Tiptap (less custom logic, real formatting/toolbar support close to
free, needs restyling, adds a real dependency). Given the toolbar
requirement above is now explicit and non-negotiable, this decision should
lean toward whichever gets a correct, accessible toolbar (proper undo
stack, keyboard shortcuts, list handling) with the least hand-rolled risk
— worth revisiting the contentEditable-by-default instinct once the full
scope above is in view, not just the inline-`/ai` part.
**Backend dependency:** `plan-backend.md` §9 (note-referencing in chat) and
§9b (note storage may need to change shape — see below).

### 11. Sidebar simplification — tried, reverted
Built once (removing the global Home/Notes/Cards/Quizzes shortcuts down to
just Home), then explicitly reverted per direct user feedback
("out quiz and notes and memory cards buttons in the main left side bar
like before") — the shortcuts are back in `Sidebar.tsx`. **Settled: keep
them.** Don't re-propose this simplification later without this context —
it was tried and rejected, not just theorized about.

## P3 — flagged, needs care before building

### 12. Flashcard predicted-retention estimate
Real risk of repeating the `fullness()` invented-metric mistake
(`retrospective.md` #4) if built carelessly. Only ship if there's a
defensible formula computed from actual stored SM-2 state (interval since
last review, ease factor) — e.g. a standard forgetting-curve decay, clearly
labeled as an estimate, not a bare "82%" presented as fact. If no
defensible formula is agreed on, don't ship a number at all.

### 13. Quiz weak-topic identification
"You're weak on Policy Iteration, not just Reinforcement Learning" requires
storing a subtopic tag per quiz question, not just a topic per quiz — a
real schema change (see `plan-backend.md` §10), not a frontend-only
grouping trick. Don't fake this by clustering on question text client-side.

### 14. Toast contrast
Confirmed via screenshot (2026-08-05): the success toast (`bg-mint
text-white` in `web/src/components/ui/Toast.tsx`) renders white text on a
bright mint-green background — hard to read. The error toast
(`bg-coral-deep text-white`, same file) has the same problem. Fix by
darkening the background token used for toast fills specifically (not the
shared `mint`/`coral-deep` tone tokens used elsewhere, which may be fine in
their other contexts) or switching toast text to a dark ink color on the
light end of those tones — whichever keeps it inside the existing Foil
Binder palette rather than introducing a one-off color. Small, no backend
dependency, but real — text that can't be read defeats the point of a
confirmation.

### 15. Landing — hero text inconsistency + marquee loop gap
Two separate bugs, confirmed via screenshot (2026-08-05):

- **Hero headline looks different between loads (sometimes bolder/heavier)**
  — this is a font-loading race, not a random rendering glitch. `index.html`
  loads Big Shoulders Display via Google Fonts with `display=swap` and
  requests five weights (500–900). On a cold cache, the browser paints the
  headline in the CSS fallback (`'Manrope', system-ui, sans-serif` — see
  `--font-display` in `web/src/index.css`) first, then swaps to the real
  font once it downloads — a classic FOUT. On a warm cache it's already
  loaded, so the same page looks different load to load depending on
  network timing, not anything actually random. Fix direction: preload the
  specific weight actually used for the headline (`font-weight` on
  `.nameplate` — check which weight that resolves to) with a `<link
  rel="preload" as="font">`, and/or narrow the requested weight list to
  only the ones actually used, so there's less to race on.
- **The horizontal source-citation marquee below the hero doesn't loop
  seamlessly — visible blank gap before it repeats.** In
  `web/src/features/landing/motion.tsx`'s `CodeMarquee`, the loop logic
  itself (duplicate the list, animate `translateX` to `-50%`) is the
  standard correct approach — the bug is that the 6 short items passed in
  from `Landing.tsx` (`'lecture-04.pdf · p.12'` etc.) don't add up to
  enough width to fill the container twice on a wide screen, so the strip
  visibly runs out and gaps before the loop restarts. Fix direction: either
  enough items (or repeated groups) to guarantee at least 2x the widest
  expected viewport width, or measure actual content width and adjust.
  **Also raised independently:** the content itself — fake source
  citations like "lecture-04.pdf · p.12" — reads as weak/generic marketing
  texture, not just buggy. Worth a real content rethink here, not just
  padding the list to fix the width bug — this is a copy/creative
  direction question, not just an implementation one.

### 16. Landing — cinematic Higgsfield pass (custom assets + scroll story)
Deferred earlier in the project for two reasons that no longer both hold:
Higgsfield's MCP tools were disconnected (now reconnected and confirmed
working, 2026-08-05) and budget was tight mid-session (still worth pacing
around, so this stays its own dedicated pass, not squeezed in alongside
other epics). Triggered by a reference site the user showed (a "Hermes
Agent" / "Nous Portal" landing page) — **inspiration for mechanics, not a
copy**: different palette (theirs is blue monochrome; ours stays the
established dark warm-ground + foil-accent system), different illustration
style, different character.

**What the reference does well, worth borrowing the mechanic of:**
- One consistent custom illustration style applied to *every* image on the
  page — not stock photos, not generic AI-art-of-the-week, one coherent
  hand throughout.
- **Bold, bright, high-contrast, unusual color combinations** — flagged
  explicitly as something to note. Important boundary: this means leaning
  *harder* into the foil accent tones Foil Binder already has (brand/sky/
  mint/sun/coral/azure/jade — all vivid, all already high-contrast against
  the dark ground) with more daring pairings than used today, not adopting
  the reference's own electric-blue monochrome — `PRODUCT.md`'s dark-only,
  no-violet commitments stand. The lesson is "be bolder with what we
  already have," not "borrow their palette."
- A giant oversized wordmark used as a mid-scroll punctuation beat, not
  just in the header.
- Small custom icon-illustrations paired with each feature bullet, instead
  of generic icons.
- A closing, full-bleed, symbolic illustration as the literal last thing
  before the footer — one image that visually summarizes the product's
  promise (their "world rotating in her palm" = a small figure holding
  something vast — a visual metaphor for the product, not decoration).
- **True full-bleed use of the viewport** — the oversized wordmark and
  illustrations run edge-to-edge, cropped by the browser window itself,
  not sitting inside a centered, padded container. Our `Landing.tsx`
  currently wraps almost everything in `max-w-6xl`/`max-w-4xl` containers
  (the same "narrow column, blank space either side" pattern flagged
  app-wide in §7, here on the one page that should least tolerate it — a
  marketing page selling boldness). Any big-type or illustration moment
  this pass adds (the mid-scroll wordmark beat, the closing illustration)
  should be full-width/full-bleed by default, not fit inside the existing
  content container.
- Smooth scroll-triggered reveals throughout — this app's own
  `useScrollProgress` / `ParallaxLayer` / `LitGrid` primitives (in
  `web/src/features/landing/motion.tsx` and `lib/useScrollProgress.ts`)
  already do this mechanically; this pass needs assets to reveal, not new
  scroll infrastructure.

**Mapped onto our actual sections (`Landing.tsx`):**
- **Hero** — currently `SealedPack` + `FloatingCards`, no illustrated
  background. Add one custom Higgsfield illustration behind/around it —
  a visual metaphor for "a mind that remembers" in our card-world
  language (not generic study-app stock imagery), animated via the
  parallax mechanism that already exists rather than as video.
- **CodeMarquee** — small custom icon-illustrations per item instead of
  plain filename text, addressing §15's "the content is weak" note at the
  same time as this pass.
- **PackScene** — already the strongest scroll-choreographed moment we
  have; candidate for a custom illustrated background behind the pinned
  scene instead of the current gradient-only `TableLight`.
- **Loop** (already 3 steps) — natural fit for the reference's "small
  custom icon per feature" treatment.
- **Close** (last section before `Footer`) — the natural spot for one big
  closing symbolic illustration, our equivalent of the "world in her palm"
  moment: something that visually says "companion, not tool" in our own
  card-world visual language (extending the `LogoMark` fanned-cards motif
  into a full illustration is one direction, not the only one).
- **Ambient motion** — the reference uses drifting birds; our on-theme
  equivalent is drifting foil motes/cards, consistent with the "warm
  ambient glow, foil sweep" language already established in `motion.tsx`,
  not a literal bird.

**Opening cinematic (back in scope, per explicit follow-up ask):** one
short Higgsfield-generated video plays full-screen before the landing page
itself — the entire viewport, no chrome — then transitions smoothly into
the Hero (fade/scale/morph into `SealedPack`'s position, not a hard cut).
This was cut earlier purely on budget-timing grounds mid-session, not on
merit; it's back in scope now, still gated on it actually looking
excellent (see cost/review note below) rather than being cinematic for its
own sake. Needs its own small state machine on the frontend (plays once
per session — `sessionStorage`, not on every navigation back to `/`;
skippable; respects `prefers-reduced-motion` by skipping straight to Hero)
in addition to the asset itself.

**Higgsfield asset list, concrete enough to act on next time:**
1. The opening cinematic video (full-screen, one-shot, a few seconds —
   long enough to land the mood, short enough not to make a returning
   visitor wait).
2. **Hero background as a full looping video**, not just a static
   illustration — concrete scene direction given: a student at a desk,
   laptop plus dual monitor, books, facing a window with a scenic view,
   small ambient moving elements in the room (not a static photo-style
   render — something alive, looping seamlessly). This replaces or sits
   behind the current `SealedPack`/`FloatingCards` treatment rather than
   stacking on top of it — decide which at build time by seeing how it
   actually reads with real text over it.
3. 3–4 small feature icon-illustrations for the Loop section.
4. One closing full-bleed illustration for the Close section — the
   "memorable last image" of the scroll.
5. Optional: a handful of small looping ambient elements (drifting foil
   motes/cards) — short, small, generated once and CSS-looped.

**Deliberately kept bounded, so this doesn't sprawl:**
- One opening video, not video backgrounds threaded through every
  section — the rest of the pass stays static/parallax illustration,
  which is far cheaper to generate, host, and keep performant.
- No literal copy of the reference's palette, character style, or layout.
- No rebuilding of scroll mechanics — reuse what already exists.

**Status:** planned, not started. Real multi-step work once picked up
(generate → review each asset against the brand commitments in
`PRODUCT.md` — dark-only, no violet, no emoji — → integrate → verify at
every scroll breakpoint) — deserves its own session, not a squeeze-in.

## Explicitly out of scope for this phase

Full knowledge-graph UI (concept map visualization, auto-extracted
relationship browsing) — see `v2-review.md` for why. Revisit only if Linked
Subspaces (§4) proves the cross-referencing need is bigger than the scoped
version handles.
