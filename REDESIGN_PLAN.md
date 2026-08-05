# Space Learn — Redesign Checkpoint

Working file for the "Foil Binder" redesign. If a session runs out of credits,
say **"check the plan file"** in the next one and work resumes from Status below.

Companion docs: `PRODUCT.md` (product truth, already written).
`DESIGN.md` gets written at the very end, from the built result.

---

## Direction (locked, do not re-litigate)

**Foil Binder** — a trading-card collection as the interface.

- Seed key `89ad8356`, mode `operate`, assigned index 5 of the grounded list.
- Chosen over: Sneaker Archive Wall, Designers Republic Noise, category standard.

Why this world: the product's atom and the form's atom are the same object.
A flashcard *is* a card. A deck *is* a set. A badge *is* a foil rarity stamp.
A citation *is* the set-code line in a card's small print. A Skill *is* a
character card you equip — which makes Skills-vs-Agents legible by **shape**
instead of by explanation.

Known risk: chat is not card-shaped. The conversation is the *table* the cards
are played on; card grammar lives in the rail, the dock, and the hand-off
moment, not in the transcript bubbles.

---

## Binding constraints (from the user, non-negotiable)

- Dark only. No light theme, no switcher.
- Not near-black — warm, mid-dark, soft. Neon-leaning accents.
- **No violet.** `#6c5ce7` is dead.
- No decorative emoji as iconography. Real drawn icons.
- No raw markdown artifacts (`**`, `##`) visible anywhere.
- Must not read as generic AI-generated design.
- **No sound effects** (decided).
- Skills and Agents stay as two concepts, made clearly distinct (decided).

---

## Token system

Ground is warm card-table, not black:

| Token | Value | Use |
|---|---|---|
| `--ink-900` | `#151110` | deepest wells, modal scrim |
| `--ink-800` | `#1E1815` | app ground |
| `--ink-700` | `#262019` | card face |
| `--ink-600` | `#2E251F` | raised card, hover |
| `--ink-500` | `#3B3028` | borders |
| `--flare` | `#FF5A3C` | primary action, streak (neon vermilion) |
| `--holo` | `#2EE6D6` | links, info (cyan) |
| `--rare` | `#FF3D8B` | rare tier, high badges (magenta) |
| `--gold` | `#FFC53D` | foil, achievement (amber) |
| `--lime` | `#B8FF3C` | correct, success |
| `--paper` | `#F5EDE4` | primary text (warm off-white, never pure white) |
| `--paper-dim` | `#B9AAA0` | secondary text |
| `--paper-faint` | `#7C6E67` | tertiary, small print |

Type (all replaced — the old Outfit / Plus Jakarta Sans are on the banned list):

- Display / nameplate: **Big Shoulders Display** — condensed athletic caps.
- Body: **Manrope**.
- Numerals, set codes, citations: **JetBrains Mono**.

Color strategy: **full palette, 3-4 named roles**. Space tones map to rarity
colors so each subject reads as its own card set.

---

## Task list

Status: `[ ]` todo · `[~]` in progress · `[x]` done

### Phase 1 — foundation
- [x] 1.1 Token layer in `web/src/index.css` — violet system fully replaced
- [x] 1.2 Fonts: Big Shoulders Display / Manrope / JetBrains Mono
- [x] 1.3 Icon set — `web/src/components/ui/Icon.tsx`, 33 drawn icons
- [x] 1.4 Primitives rebuilt: Button, Card, Bits, Input, Modal, EmptyState
- [x] 1.5 Direction contract in `web/index.html` body

### Phase 2 — core flows (the funded scope)
- [x] 2.1 Sign in / sign up — narrow form, wide animated foil panel showing
      real card artifacts (question + answer + citation line)
- [x] 2.2 App shell — collapsible rail (persisted), overflow fixed via
      `min-w-0` + `overflow-x-hidden`, Skills card only when a topic exists
- [x] 2.3 Home — LLM brief hero, standing cards, topics as face-up cards
- [x] 2.4 Chat dock — Skills are cards, Agents are bolt buttons; `skills`
      removed from `AgentKey` entirely (it was the root of the confusion)
- [x] 2.5 Flashcards — full card CRUD, real 3D flip, markdown stripped,
      keyboard grading, deck detail screen, generate-a-deck modal

### Phase 3 — backend truths
- [x] 3.1 `POST /subspaces/{id}/cards/generate` — writes a real deck
- [x] 3.2 `GET /me/brief` — 8B model, with a quantity guard + Title Case
      normaliser + deterministic fallback (`generated:false`)
- [x] 3.3 `stripMarkdown` in `web/src/lib/text.ts`, applied on card faces
- [x] 3.4 Badges rebuilt: 6 badges, tiers (common/rare/elite), icon names
      instead of emoji, and a `hint` so locked ones aren't dead ends

### Phase 2.5 — landing page (added mid-flight, user request)
- [x] Landing at `/` for signed-out visitors, GitHub-style: signed-in users
      go straight to `/home` and never see marketing. `/welcome` always shows it.
- [x] Structure: **the pack opening** (surface seed `ee6347f5`, index 5).
      Sealed foil pack → scroll tears it → four real artifact cards spill and
      settle → thesis lands.
- [x] Motion primitives in `features/landing/motion.tsx`: `DealText` (words
      land like dealt cards), `FoilText` (highlight sweeps across glyphs, not
      gradient fill), `CodeMarquee`, `usePointerParallax`, `ParallaxLayer`.
      Written in-world rather than pulled from a generic animation kit.
- [x] Real 3D depth: grid / floating cards / pack on separate parallax layers
      responding to the pointer at different rates.
- [ ] Not yet visually verified in a browser — see Known gaps.

### Phase 4 — lighter pass
- [x] 4.1 Profile — full-width; identity / standing / activity+badges. Badge
      seals carry tier rings and show their hint when unearned.
- [x] 4.2 Settings — widened from a 512px column (the reason it read as
      "empty"); nav and cards on the new tokens. Feature set unchanged.
- [x] 4.3 Emoji purge — Skills, Docs, Notes, Chat all on drawn icons.
      `skillIcon.ts` maps legacy emoji rows so seeded skills render correctly.
- [x] 4.4a Quizzes — card grammar (nameplate title, set-code metadata,
      question count leading), grid fills the width, ends with a
      "Generate another" slot, empty state centres in its space
- [x] 4.4b Docs — grid layout (was a centered max-w-2xl list), fixed a real
      bug where the file-type icon rendered literal text ("doc"/"note")
      instead of an Icon component, status badges now drawn icons in tone
      chips (was raw glyphs ↑ … ✓ !), hover-reveal reprocess/delete, dashed
      "Drop files, or click to browse" tile closes the grid

### Phase 4.5 — feedback round (from live screenshots)
- [x] Contrast: `faint`/`muted`/`ink-3` lifted; `.setcode` 10.5px → 11.5px
- [x] Rail typography up a step, brighter, bolder
- [x] **Brief no longer rerolls on every navigation** — `briefCache.ts` holds
      it for the session (sessionStorage), shares the in-flight promise, and
      clears on sign-out
- [x] Toggle knob fixed (missing `left`, drifted outside its track)
- [x] Favicon replaced — was still the default Vite bolt, in violet
- [x] Logo lockup animated: mark fans on hover, foil sweeps the wordmark
- [x] Auth panel: 7 artifacts (not just flashcards), tight cluster, no
      text-destroying overlaps, copy rewritten to "Ask once. Keep it forever."
- [x] Ambient light drifts on its own clock; only the grid tracks the cursor
- [x] Multicolour wash removed — warm tones only
- [x] Chat "thinking" is animated, was a static ellipsis
- [x] 3D buttons (`solid3d` / `outline3d`) with real press travel
- [x] Two more subject accents (`azure`, `jade`) + migration
      `20260805090000_more_tones.sql` — applied and verified live (a jade
      insert round-tripped cleanly against the widened CHECK constraint)
- [x] Home bottom filled honestly — subjects with no topics render as empty
      binder slots instead of vanishing from the grid
- [x] Cards/Quizzes empty states now centre in the height they have
- [x] Streak ledger on Home — 14 animated bars, hover to interrogate a day,
      streak read off the chart itself (`features/home/StreakLedger.tsx`)
- [x] Removed the topic "progress" bar — it rendered a `fullness()` score
      invented from counts and implied progress through material it never
      measured
- [x] Subject names now carry their own tone colour in the rail; `SectionLabel`
      promoted to `.setcode-strong` (was `faint`, read as disabled)
- [x] Rail scroll bounded — the wrapper had no definite height, so a long
      subject list pushed the footer off-screen instead of scrolling
- [x] Ambient lamp light restored to authed pages — `AppShell` painted flat
      `bg-canvas` over the body gradient, so every inner page sat on solid
      colour while landing/auth had the warm table look
- [x] Broader micro-animation pass:
      Notes — animated save indicator (pulsing dot while saving, check on
      saved, alert on failure; was static grey text), list rows animate their
      active-state border instead of a hard cut, "+" new-note and "← All
      notes" now drawn icons instead of raw glyphs.
      Skills — own/library cards get the same hover-lift as decks/quizzes/docs,
      "write your own" tile uses a drawn plus icon instead of a bare glyph.
      Profile — earned rare/elite badges get the foil shimmer on hover (common
      badges stay quiet on purpose — the shimmer means something).
      Settings — all three "saving…" indicators replaced with a shared
      pulsing-dot component (`SavingDot`); number/time/select inputs moved off
      the stale flat-surface tokens onto the border+well convention every
      other field in the app already uses.

### Phase 5 — finish
- [x] 5.1 Batched screenshot rounds — 8 authed surfaces at 1440px, auth at
      six device widths (390 / 768 / 1024 / 1280 / 1440 / 1920). Zero
      horizontal overflow anywhere, no page errors, no raw error text.
- [x] 5.2 `detect.mjs --json` over `web/src` → `[]`, no mechanical findings.
- [x] Analytics heatmap fixed properly: the window was 8 weeks, too few
      columns to fill the card at any cell size. Backend now returns ~26
      Monday-aligned weeks; the grid gained weekday labels and month ticks.
- [x] 5.3 `impeccable-finish-reviewer` verdict — skipped, user call
- [x] 5.4 `impeccable-documenter` → `DESIGN.md` — skipped, user call

---

## Status

**Status: done.** User reviewed the landing page scroll live ("works but not
great") and closed out Phase 5 without the finish-reviewer/DESIGN.md steps.
**Last completed:** Full Phase 4 (Profile, Settings, Skills, Docs, Notes all
on the new tokens) and the Phase 4.5 micro-animation pass. Verified: typecheck
clean, build clean, 8 authed surfaces screenshotted at 1440px with zero
horizontal overflow (Home, Quizzes, Cards, Profile, Docs, Notes, Skills,
Settings).

## Known gaps (read before claiming done)

1. **The landing page has never been seen in a browser.** The headless
   browser's system libs were cleaned out of an old scratchpad and could not
   be refetched this session; Windows Chrome over WSL can't expose CDP. It
   typechecks and builds, but scroll timings, the pack-tear beat, and the
   parallax depths are *unverified by eye* and will likely need tuning.
2. Phase 4 pages (Profile, Settings, Quizzes, Docs) still carry old layout —
   they inherit the dark tokens but were not composed for this world.
   Settings is still largely empty of features.
3. The Phase 5 finish review has not run. The direction contract in
   `web/index.html` ends with a FINISH line that is still undischarged.

**Verified working:** `tsc -b --noEmit` clean · `npm run build` clean ·
backend 48 routes · ruff clean · brief tested live against Groq (quantity
guard and Title Case normaliser both confirmed firing).

**Next action:** Phase 4 (Profile, Settings, Quizzes, Docs) — mechanical, safe for a
cheaper model. Then Phase 5 finish review — **not optional**, the direction
contract in `web/index.html` ends with a FINISH line that this run must
discharge.

**Nothing is committed yet.** Working tree also carries earlier uncommitted
work (markdown chat rendering, auth resend flow, dev script, JWT fallback).

---

## Notes for a resumed session

- Do **not** re-run `concept-seed.mjs`. The direction is locked above.
- Do **not** re-interview for PRODUCT.md. It exists.
- Read the direction contract at the top of the root layout before editing UI.
- Load `reference/craft-floor.md` before touching UI code.
- Model guidance: Opus for Phases 1-3 (judgment). Phase 4 is mechanical and a
  cheaper model can do it from the token table above.
