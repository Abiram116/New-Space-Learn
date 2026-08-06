# Design Plan — every surface, and the assets that carry it

The execution plan for making the whole product look and feel like one
deliberate thing, page by page, including what gets generated in Higgsfield
and the exact brief for each asset.

Read [vision.md](vision.md) first. This document is downstream of it: the
question every item here answers is *"does this make the product feel like
a companion with a memory, or like a website you operate?"*

Companion doc: [plan-frontend.md](plan-frontend.md) covers functional
epics. This one covers look, motion, and asset production. Where they
overlap (§15, §16 there) this document is the more detailed one.

---

## 1. The gap this plan exists to close

An audit on 2026-08-05 found the clearest inconsistency in the product:

> **The landing page has a full motion vocabulary. The app has hover colours.**

`features/landing/motion.tsx` carries parallax, scroll-driven reveals, foil
sweeps, a lit grid that tracks the cursor. Behind it, the app used
`transition-colors` and almost nothing else — 45 of them, and 4 uses of
`animate-pulse`. A student meets a crafted, cinematic world in the pitch,
signs up, and lands somewhere static.

That is a vision failure, not a polish gap. "Own world" cannot stop at the
marketing page.

**Already shipped against this** (2026-08-05, see `components/ui/motion.tsx`):
a small app-side motion vocabulary — `Rise`, `Stagger`, `PageTransition`,
`CountUp`, `useReducedMotion` — with page cross-fades in `AppShell`, dealt-in
topic cards on Home, and a counting streak figure. Deliberately smaller than
the landing primitives: nothing over ~320ms, nothing that blocks input.

---

## 2. Motion principles for the app

These exist so future motion work doesn't have to be re-argued each time.

1. **Motion explains a state change, or it doesn't ship.** Something
   arrived, something reordered, you moved. Decoration that survives a
   second look is rare; decoration that survives the hundredth is rarer.
2. **Nothing over ~320ms in the app.** The landing page may take its time
   because it's a performance. A screen you open every day may not.
3. **Never animate a number that isn't the point.** The streak counts up
   because the streak is the moment. If every figure animated, the page
   would read as a slot machine.
4. **`prefers-reduced-motion` renders the final state, not a faster
   animation.** For vestibular triggers a quick movement is still movement.
5. **Stagger is capped.** A 40-item list at 40ms each takes 1.6s to finish
   arriving — that's not motion, that's waiting. Cap at ~240ms total.
6. **No spatial slide between app pages.** The pages aren't ordered, so a
   slide implies a relationship that doesn't exist, and fights a sidebar
   that stays put. Cross-fade only.

---

## 3. Per-page plan

Ordered by how much a student sees it.

### 3.1 Landing — the cinematic pass

The biggest single piece of work here, and the one most dependent on
generated assets. Full brief in §4.

| Section | Today | Target |
|---|---|---|
| Pre-roll | none | Short full-screen cinematic, once per session, transitions into Hero rather than cutting |
| Hero | `SealedPack` + floating cards on a gradient | Looping video scene behind the type (§4.1); the pack becomes a foreground element |
| CodeMarquee | 6 fake filenames, gaps on wide screens | Real content rethink + enough items to loop seamlessly (`plan-frontend.md` §15) |
| PackScene | pinned scroll, 4 cards spill | Illustrated backdrop replacing the flat `TableLight` gradient |
| Loop (3 steps) | drawn icons | Custom illustration per step (§4.2) |
| Collection | cards | keep, restyle to sit against new art |
| Close | text + button | Full-bleed closing illustration (§4.3) — the last image you remember |

**Non-negotiable:** the current `max-w-6xl` wrapper on nearly everything is
what makes the page feel timid. Big type and illustration moments go
edge-to-edge, cropped by the viewport, not padded inside a container.

### 3.2 Home — the companion's opening move

The most vision-critical screen in the app, and the closest to right
already: the brief is real, the suggestion is computed, nothing is invented.

- **Ship:** `Rise` on the brief block so the headline arrives rather than
  blinking in. *(done)*
- **Ship:** dealt-in topic cards. *(done)*
- **Next:** when `suggestion` is present, give its CTA a subtle foil sweep
  on hover — it's the one button the product is actually recommending, and
  it currently looks identical to a secondary action.
- **Next:** the empty/first-run state is the weakest copy in the app
  ("Nothing in the binder yet"). It should sound like the companion
  introducing itself, not a database reporting zero rows.

### 3.3 Chat — where the relationship actually happens

- **Next:** streamed replies currently appear token-by-token with no
  entrance; the first token should fade the bubble in.
- **Next:** the `Thinking` indicator is a 3-dot pulse — fine, but generic.
  A foil shimmer along a card edge would be ours.
- **Next:** citations pop in as `[[n]]` badges mid-stream. Give them a
  200ms scale-in so they read as arriving evidence.
- **Watch:** `ContextDock` is where Skills/Agents/Sources live and is the
  most information-dense surface in the app. Resist adding motion here —
  it's a reference panel, not a stage.

### 3.4 Notes — the newest and least proven surface

Rebuilt on Tiptap on 2026-08-05 and **never verified in a browser**. Before
any polish:

- **First:** click through inline `/ai`, the toolbar, and markdown
  round-tripping. Implemented to the documented API, not visually confirmed.
- **Next:** the `/ai` placeholder currently inserts the literal text
  "Thinking…" into the document. It should be a styled inline chip that
  can't be mistaken for note content, and can't survive a failed request.
- **Next:** toolbar buttons use text glyphs (`B`, `I`, `U`, `S`, `•—`,
  `1.`). Fine as a first cut; drawn icons would match the rest of the app.

### 3.5 Cards / Quizzes — the study loop

- **Next:** the flashcard flip is a real 3D rotate and is the best single
  interaction in the app. The grade buttons after it are flat and are the
  weakest — they were flagged as "doesn't feel good" and still are. They
  need a real interaction pass, not a spacing tweak.
- **Next:** quiz results reveal all questions at once. Stagger them.
- **Next:** submitting a quiz jumps to a score. Count it up (`CountUp`
  already exists).

### 3.6 Docs / Skills / Settings / Profile

- **Docs:** upload progress works; the processing → ready transition is a
  status flip with no motion. A card settling when it becomes citable would
  make indexing feel like it completed.
- **Skills:** cards already hover-lift. Nothing needed.
- **Settings:** deliberately still. A settings page that animates is a
  settings page that annoys.
- **Profile:** the only page in the app with **no empty state at all** — a
  brand-new account sees empty charts with no explanation. Fix before
  polish.

---

## 4. Higgsfield asset briefs

Higgsfield's tools are connected and confirmed working. Each brief below is
written to be pasted more or less directly.

**Global style contract — every asset must obey, or it doesn't ship:**
- Warm dark ground (`#1E1815`), never pure black.
- Foil accents only: vermilion `#FF5A3C`, cyan `#2EE6D6`, lime `#B8FF3C`,
  gold `#FFC53D`, magenta `#FF3D8B`. **No violet or purple anywhere** —
  this is a standing brand commitment from `PRODUCT.md`.
- One consistent illustrative hand across every asset. Assets that look
  like they came from different generators are worse than no assets.
- Bold, high-contrast, unusual pairings *within* that palette. The
  reference site that prompted this used electric-blue monochrome; the
  lesson taken is "be braver with our own palette", not "use theirs".
- No text rendered inside generated images — type is live HTML, always.

### 4.1 Hero background — looping video

> A student at a wide wooden desk at night, seen from behind and slightly
> above. Laptop plus a second monitor, both glowing warm amber. Open books
> and loose paper. Beyond the desk, a tall window onto a calm scenic view.
> Slow ambient life: faint parallax drift, a soft flicker on the screens,
> dust catching the light. Warm dark interior, near-black warm brown
> shadows, amber and vermilion light sources, one small cyan accent from a
> screen. Cinematic, painterly, unhurried. Seamless loop. No text, no UI,
> no faces visible.

Constraints: seamless loop, ≤10s, muted, must sit *behind* white display
type without competing — keep the upper-left third visually quiet.
Fallback: a still frame at the same crop for reduced-motion and slow
connections.

### 4.2 Loop-section icons — 3–4 illustrations

> A single object on a warm dark ground, drawn in one consistent hand:
> foil-edged linework, high contrast, one accent colour per piece.
> (a) a stack of cards fanning open; (b) a document with a glowing line of
> text lifting off the page; (c) a question mark formed from folded paper;
> (d) a small lamp lighting one card in a row of dim ones.

Constraints: square, transparent or flat `#1E1815` ground, readable at
64px, one accent each — assign vermilion / cyan / gold / lime so they read
as a set.

### 4.3 Closing full-bleed illustration

The last image on the page, and the one meant to be remembered. Our answer
to the reference's "world held in a palm".

> A vast dark library or archive rendered as a wall of faintly glowing
> cards receding into depth. In the foreground, one card is lifted and lit,
> warm vermilion, clearly *chosen*. Everything else is dim but present. A
> sense that something knows exactly which one mattered. Warm dark palette,
> cinematic depth, painterly. No text, no figures.

This is the visual thesis of the product: not "here is everything you
uploaded" but "here is the one thing worth doing next".

### 4.4 Opening cinematic — pre-roll video

> A sealed foil card pack resting in warm darkness. Light creeps across the
> foil, catching vermilion and cyan. The pack tears open and light floods
> out, dissolving into drifting cards that scatter toward the viewer and
> resolve into calm. Cinematic, dramatic lighting, warm dark palette.

Constraints: ≤4s, must end on a composition the Hero can cross-fade out of.
Plays once per session (`sessionStorage`), always skippable, skipped
entirely under `prefers-reduced-motion`.

### 4.5 Ambient loop elements (optional, last)

Small drifting foil motes/cards for the Hero, generated once and CSS-looped.
Only if §4.1–§4.4 land well — this is garnish, not structure.

---

## 5. Sequencing

Ordered so nothing is blocked and value lands early.

**Phase 1 — verify and fix (no assets needed)**
1. Click through the Notes editor. It is unverified and it is the newest
   thing in the app.
2. Profile empty state.
3. Toast contrast (`plan-frontend.md` §14).
4. Landing font race + marquee gap (`plan-frontend.md` §15).

**Phase 2 — motion, no assets**
5. Chat entrance + citation reveal.
6. Quiz results stagger + score count-up.
7. Flashcard grade-button interaction redesign.
8. Home suggestion CTA emphasis.

**Phase 3 — assets (its own session)**
9. Generate §4.2 icons first — smallest, fastest to judge whether the
   style contract is being met before committing to video.
10. §4.1 hero video, §4.3 closing illustration.
11. §4.4 pre-roll last: it's the most expensive, the least essential, and
    the easiest to get wrong.

**Phase 4 — integrate**
12. Full-bleed landing restructure (removing `max-w-6xl` caps).
13. Asset integration + verification at every breakpoint.

Judge each generated asset against §4's style contract *before* wiring it
in. An asset that doesn't fit the world is worse than a gradient.

---

## 6. Standing risks

- **Bundle weight.** The app is 245 KB gzipped on first load after
  splitting. Video and imagery must be served as separate assets, lazily,
  never bundled. A cinematic landing page that takes six seconds to arrive
  has defeated itself.
- **Asset drift.** The single biggest failure mode is assets that don't
  look like each other. Generate in sets, review together, regenerate the
  whole set rather than patching one.
- **Motion creep.** Every animation is charming once and tiring at the
  hundredth repeat. When in doubt, don't.
- **Verification.** The recurring lesson in `retrospective.md` is that
  things get called done without being looked at. Every item here needs a
  browser, not a typecheck.
