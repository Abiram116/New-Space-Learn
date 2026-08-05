# Architecture

## Repo layout

```
web/         React 19 + Vite + TS + Tailwind v4   → Vercel
api/         FastAPI + uv (async, singletons)     → Render (free tier)
supabase/    Postgres + pgvector + RLS migrations → Supabase
render.yaml  Backend deploy manifest
docs/        You are here
```

## The data model: Subjects → Subspaces

Everything in the product hangs off this two-level hierarchy:

- A **Subject** is a broad area the student is studying ("Reinforcement
  Learning"). It carries a tone color (one of `brand / sky / mint / sun /
  coral / azure / jade`) that identifies it everywhere in the UI — the rail,
  card accents, badges.
- A **Subspace** is a specific topic inside that subject ("Markov decision
  processes"). Every document, chat message, note, deck, and quiz belongs to
  exactly one subspace.

Nothing crosses subspace boundaries today — a chat in one topic can't see
documents indexed in another. That's a deliberate default described further
in [backlog.md](backlog.md) (cross-context knowledge sharing is an open,
unscheduled idea, not a limitation nobody noticed).

## The contract between frontend, backend, and database

- **The frontend never calls Groq or the database directly.** It talks to
  Supabase Auth for sign-in/sign-up only, and to the FastAPI backend for
  every other read and write.
- **The backend owns all AI orchestration** (retrieval → prompt construction
  → streaming the model's reply → persisting citations) and every privileged
  write. It authenticates using the Supabase **service role key**, which
  bypasses Row Level Security entirely.
- **Because the service key bypasses RLS, RLS is a second line of defense,
  not the primary one.** Every backend handler that accepts a caller-supplied
  id (a `subspace_id`, a `deck_id`) must prove the caller owns that row
  before touching it — via the shared helpers in `api/app/guards.py`. A
  route that skips this reintroduces cross-user data leaks; this has
  happened before and was fixed (see `assert_subspace` / `assert_deck`
  call sites for the pattern to copy).
- **The database is the source of truth.** Every table is scoped to
  `user_id = auth.uid()` via Row Level Security, defined in
  `supabase/migrations/`.

## Free-tier discipline (backend)

Render's free tier gives 512MB RAM, one CPU, and spins the service down
after 15 minutes of inactivity. The backend is written to that budget on
purpose:

- **Single uvicorn worker.** No multiprocessing.
- **Module-level singletons** for the httpx client, the Supabase wrapper,
  and the Groq client — created once per process, reused for every request.
- **All I/O is async.** No blocking calls in a request path.
- **Streaming responses** for chat (Server-Sent Events) so a long model
  reply never sits fully buffered in memory.
- **No background workers.** Document embedding runs inline inside the
  upload request, capped at 25 seconds; a `reprocess` endpoint lets a
  timed-out document finish on a second call instead of needing a queue.

## Error handling contract

Every backend error — expected or not — returns the same JSON envelope:

```json
{ "error": { "code": "unauthorized", "message": "Please sign in again." } }
```

Codes in use: `unauthorized`, `forbidden`, `not_found`, `validation_error`,
`rate_limited`, `upstream_unavailable`, `not_configured`, `internal_error`.
The frontend's `friendlyMessage()` (`web/src/api/errors.ts`) maps every one
of these to plain-English toast copy. **No raw error, stack trace, or
provider error body is ever allowed to reach the screen** — this is a hard
rule, not a preference, because a provider's error text can carry account or
quota details that shouldn't be user-visible.

## Missing configuration never crashes the app

If `GROQ_API_KEY` or the Supabase keys aren't set:

- The frontend shows a friendly `ConfigMissing` card instead of a blank
  screen or a thrown error.
- The backend's `StubLLM` (`api/app/services/llm.py`) streams a canned "AI
  isn't configured yet" reply, so the whole chat UI stays clickable and
  testable without a real key.
- `USE_STUB_EMBEDDINGS=true` inserts deterministic pseudo-vectors instead of
  calling a real embedding provider, so upload → chunk → retrieve still
  works end-to-end with no embedding key.

## The AI layer

- **LLM Protocol** (`api/app/services/llm.py`): `GroqLLM` and `StubLLM` both
  implement the same `stream_chat` interface, so swapping providers or
  degrading gracefully never touches route code.
- **Model tiering** — one Groq key, three models chosen per request so cheap
  work doesn't pay 70B latency or quota:

  | Setting | Default | Used for |
  |---|---|---|
  | `GROQ_MODEL` | `llama-3.3-70b-versatile` | RAG chat, quiz generation |
  | `GROQ_MODEL_FAST` | `llama-3.1-8b-instant` | short, low-stakes prompts (e.g. the Home re-entry brief) |
  | `GROQ_MODEL_VISION` | `qwen/qwen3.6-27b` | image input — configured but not yet wired to a feature |

  Groq retires model ids periodically; confirm current ones against
  `GET /openai/v1/models` before changing these.

- **RAG** (`api/app/services/rag.py`): `retrieve()` calls the
  `match_document_chunks` Postgres function (cosine similarity over
  pgvector embeddings, scoped to one subspace); `build_prompt()` assembles
  the system message, the retrieved source snippets with citation markers,
  recent chat history, and any active Skill's instructions.
- **Quota protection** (`api/app/services/ratelimit.py`): a per-user
  in-process token bucket in front of every LLM-backed endpoint — 20 burst,
  refilling 20/minute. In-process because the free tier runs a single
  worker; if that ever changes, this needs a shared store (Redis or
  Postgres) instead.
- **Groq error mapping**: a 429 from Groq becomes our `rate_limited` code
  (tells the user to wait), not a generic outage; a 401/403 becomes
  `not_configured` (the key is wrong, and the user can't fix that from the
  app). Provider error bodies are logged, never surfaced.

## The design system ("Foil Binder")

The frontend's visual identity is a deliberate choice, not a default theme:
a warm, dark, trading-card-collection world where the product's own atom (a
question-and-answer pair) and the visual atom (a card) are the same object.
Concretely:

- **Dark only**, warm ground (`#1E1815`), never nearing black.
- **No violet** — the original wireframe's brand color was explicitly
  rejected during the redesign.
- **Foil accent tones** (`brand/sky/mint/sun/coral/azure/jade`) double as
  both a Subject's color identity and a badge's rarity tier.
- **Real drawn icons** (`web/src/components/ui/Icon.tsx`, ~33 icons) — no
  emoji as iconography anywhere in the product UI.
- **Typography**: Big Shoulders Display (condensed caps, used for
  "nameplate" headings), Manrope (body), JetBrains Mono (small print, set
  codes, citations — the `.setcode` class).

Every card in the app — a flashcard, a deck tile, a quiz card, a badge — is
built on the shared `cardstock` CSS class (`web/src/index.css`), so a new
card-shaped surface should reuse that instead of inventing new elevation/
border treatment.

## Repo tour

- **`web/src/api/`** — the only place that talks HTTP. `client.ts` is the
  fetch wrapper (auth header, error envelope parsing, network-failure
  normalization). One file per resource (`spaces.ts`, `chat.ts`, etc).
- **`web/src/auth/`** — `AuthProvider` owns the Supabase session;
  `RequireAuth` / `RedirectIfAuthed` are the route guards.
- **`web/src/components/ui/`** — small primitives with no app-specific
  logic: `Button`, `Card`, `Modal`, `Toast`, `Input`, `EmptyState`,
  `Skeleton`, `ConfirmDialog`, `Icon`, `Logo`.
- **`web/src/features/`** — one folder per feature; each owns its views and
  local helpers. `features/spaces/SpacesProvider` is the one piece of
  genuinely global state — the sidebar's space tree — since every screen
  needs it.
- **`web/src/features/landing/motion.tsx`** — the motion primitives written
  for this app's own visual grammar (`DealText`, `FoilText`,
  `usePointerParallax`) rather than pulled from a generic animation library.
- **`api/app/main.py`** — the FastAPI factory: CORS, exception handlers,
  router registration, the client-shutdown lifespan.
- **`api/app/services/`** — `supabase.py` (httpx-based Supabase wrapper —
  deliberately not the official SDK, to save memory on the free tier),
  `llm.py`, `embeddings.py`, `rag.py`, `ratelimit.py`, `activity.py`
  (streak/badge bookkeeping, consolidated from three near-duplicate copies
  that used to live in different routers).
- **`api/app/routers/`** — one file per domain; every handler is `async`
  and every error goes through the shared JSON envelope.
- **`api/app/guards.py`** — the ownership-assertion helpers every router
  must call before touching a caller-supplied row id.
- **`supabase/migrations/`** — timestamped and additive-only; never edit an
  already-applied migration, add a new one.

## What isn't built yet (intentional gaps, not oversights)

- Account deletion — no backend endpoint. Settings says so plainly instead
  of showing a button that doesn't work.
- Background reminder notifier — the preference persists, but firing one
  needs a scheduled worker the free tier won't run reliably.
- Cross-subspace / cross-subject knowledge sharing — see
  [backlog.md](backlog.md).
- A rich-text notes editor with inline AI — currently a plain markdown
  textarea; see [backlog.md](backlog.md).

See [backlog.md](backlog.md) for the fuller, currently-unscheduled list of
product ideas raised during the redesign review.
