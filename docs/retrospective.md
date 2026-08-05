# Retrospective — lessons from the Foil Binder redesign

A record of what went wrong during the visual redesign and product-depth
review, kept here (not just in chat history) so the pattern behind each
mistake stays visible to future work. See [backlog.md](backlog.md) for the
concrete problems this review surfaced.

## What we got wrong

1. **Shipped "done" before checking the actual data shape.** The activity
   heatmap looked fixed after the first pass — typecheck clean, build
   clean — but was structurally wrong: 8 weeks of data can never fill a wide
   card no matter how the CSS is written. The real fix was widening the
   *data window* (8 → 26 weeks), not styling the cells harder.
   **Lesson:** a layout complaint is sometimes a data-shape problem wearing
   a CSS costume. Check what's actually being rendered before restyling the
   container around it.

2. **A refactor changed a function's contract without updating every call
   site.** The emoji-purge pass changed what `iconFor()` returned (icon
   names instead of emoji), but the render call
   (`<span>{iconFor(...)}</span>`) was never updated to actually render an
   `<Icon>` component — so it printed the literal string `"doc"` next to
   every filename for several sessions before anyone caught it.
   **Lesson:** when a refactor touches a function's contract, grep every
   call site in the same pass. "It typechecked" is not proof the render is
   correct — a string return type satisfies both the old and new usage.

3. **A systemic fix wasn't checked systemically.** `AppShell` painted a
   flat `bg-canvas` directly over the body's ambient light gradient, so
   *every* inner page sat on solid color instead of the intended warm
   table-light look — for the entire redesign, because whichever page was
   being actively worked on in isolation looked fine on its own.
   **Lesson:** a shared visual property (ambient light, a design token, a
   layout primitive) needs a systemic check across every consumer. One page
   rendering correctly is not evidence the shared parent is correct.

4. **An invented metric looked like a real one.** The per-topic "progress"
   bar on Home was computed from a `fullness()` formula with no ground
   truth behind it — it *looked* like meaningful progress tracking and was
   actually decoration wearing a data widget's clothes.
   **Lesson:** before adding any number, bar, or chart, be able to state in
   one sentence what real, stored fact it represents. If the honest answer
   requires an invented weighting formula, don't ship it.

5. **Verification tooling was rebuilt instead of made durable.** A
   significant fraction of the redesign session went into re-fighting
   headless-browser system libraries (`libnspr4`, `libnss3`) that kept
   getting cleaned out of session-scoped scratchpad directories, and
   preview servers colliding on ports. None of that is app work.
   **Lesson:** if a verification setup needs rebuilding more than twice in
   one project, it should live somewhere persistent, not in a
   session-scoped temp directory.

6. **Some design decisions were re-litigated in small increments instead of
   settled once.** The auth panel's content (flashcards-only → a
   six-artifact spread representing the whole product), the ambient
   light's behavior (cursor-synced → autonomous), and the subject color
   palette all went through 2-3 rounds of live feedback before landing.
   Iteration itself isn't the problem — but several of these rounds were
   reacting to something a first-principles question would have caught
   before any code was written (e.g. "does this panel represent everything
   the product does, or just one feature?").

## The throughline

**Verify against the actual rendered output and the actual stored data —
never against "it typechecks" or "it looks plausible in the diff."** This
discipline held for the parts of the project that went smoothly (the
backend ownership-guard security fixes, the RAG grounding work) and was
missing for the parts that needed a second pass.

## The standing checklist — apply to every future feature

- **Who is using this, in what moment, wanting what?** Not "what does this
  screen show" but "a student mid-cram-session opens this — what do they
  need in the next 5 seconds?" If that can't be answered concretely, the
  feature isn't specified yet, no matter how polished the mockup looks.
- **What's the edge case that breaks the happy-path assumption?** Empty
  state, exactly one item, a thousand items, an 80-character name, a
  network call that fails halfway. This is part of "done," not a follow-up
  bug report.
- **Does every number/bar/chart on screen point at something real and
  stored?** If not, compute it honestly or don't show it.
- **Does this page use the space it has, or center a card in a void?**
  Full-bleed, content-driven layout is the default posture for this app —
  a narrow centered column is the exception that needs justifying.
- **Is the AI actually grounded, or just handed a topic string?** Every
  prompt this app builds should carry what subject/subspace this is, what's
  actually indexed, and what the user has actually engaged with — never a
  bare word handed to the model and hoped for the best.
- **Would a first-time visitor understand this without me explaining it?**
  Applies to UI copy, error messages, and the project's own documentation.
