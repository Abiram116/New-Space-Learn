# Space Learn — documentation

Start here if you're new to this codebase. Each doc below answers one kind of
question — read the one that matches what you're trying to do, not all of
them front to back.

| Doc | Read this when you want to know... |
|---|---|
| [vision.md](vision.md) | What this product is trying to *be* — a companion with memory and initiative, not a tool. Read this first; it's the lens every other doc and every future feature gets judged through. |
| [architecture.md](architecture.md) | How the pieces fit together: the monorepo shape, the Subjects → Subspaces data model, the "Foil Binder" design system, and why the frontend never talks to the AI provider directly. |
| [setup.md](setup.md) | How to run this locally, wire up Supabase, and deploy to Render + Vercel. |
| [retrospective.md](retrospective.md) | What went wrong during the redesign, the pattern behind each mistake, and the standing checklist we now hold every new feature to. |
| [backlog.md](backlog.md) | The open, not-yet-scheduled list of product problems and ideas — organized by area, not by priority. |
| [v2-review.md](v2-review.md) | An external product review, and my own point-by-point response — including a real disagreement (and its resolution) over whether to replace Subjects/Subspaces with a knowledge graph. Read before scoping anything graph- or personalization-shaped. |
| [plan-frontend.md](plan-frontend.md) / [plan-backend.md](plan-backend.md) | The prioritized, scoped plan of functional epics — frontend and backend halves kept separate but cross-referenced by epic number. §1–§13 are shipped; §14–§16 are open. |
| [design-plan.md](design-plan.md) | How every surface should look and move, page by page, plus the Higgsfield asset briefs (with real prompts) and the sequencing to produce them. Read with `vision.md`. |

## The one-paragraph version

Space Learn is a study app built around one idea: a student uploads their own
material into a **Subject → Subspace** (e.g. "Reinforcement Learning" →
"Markov decision processes"), asks it questions, and every answer can become
something to study from later — a flashcard, a note, a quiz — each still
pointing back at the page it came from. The frontend is React on Vercel, the
backend is FastAPI on Render (free tier, so it's built to a strict memory and
CPU budget), and Postgres+pgvector on Supabase is the single source of truth.
Nothing shown in the app is invented — every number, chart, and streak is
computed from something actually stored.
