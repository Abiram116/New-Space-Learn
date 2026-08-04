# Space Learn

AI-powered learning platform. Subjects → Subspaces, each with AI chat that cites your uploaded documents, notes, flashcards (SM-2 lite), quizzes, and custom AI personas ("skills").

## Repo layout

```
web/         React 19 + Vite + TS + Tailwind v4  → Vercel
api/         FastAPI + uv (async, singletons)    → Render (free tier)
supabase/    Postgres + pgvector + RLS migrations → Supabase
render.yaml  Backend deploy manifest
```

## Contract at a glance

- **Frontend** never calls Groq or the database directly. It talks to Supabase Auth for sign-in and to the FastAPI backend for everything else.
- **Backend** owns the AI orchestration (RAG → LLM → citations) and privileged writes. Uses Supabase service key.
- **Database** is the source of truth. All tables enforce RLS on `user_id = auth.uid()`.
- **Missing env vars** never crash the app. The UI shows a friendly `ConfigMissing` card; the backend returns a `not_configured` error envelope; chat degrades to a canned "no AI key" stub reply so the flow is still exercisable.
- **Every error** hits the user as a toast with plain-English copy — no stack traces.

## Local setup

```bash
cp .env.example .env       # fill in Supabase + Groq keys as you get them

# Frontend
cd web && npm install && npm run dev            # http://localhost:5173

# Backend
cd api && uv sync && uv run uvicorn app.main:app --reload --port 8000
```

Nothing else is required — mock data has been removed. If either key is missing, features that need it show a friendly explanation instead of erroring.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. **Link the GitHub repo**: Dashboard → Database → Migrations → connect this repo. Every push to `main` runs the SQL files in `supabase/migrations/` in filename order.
   - The first migration enables `pgvector` and `pgcrypto`, creates every table, and inserts a private Storage bucket named `documents`.
   - The second migration enables RLS on every table and pins ownership to `auth.uid()`.
   - The third migration installs the `match_document_chunks` RPC (used by RAG) and seeds four library skills every user can add to their space.
3. **Google OAuth**: Dashboard → Authentication → Providers → Google. Paste the client id and secret from Google Cloud Console. Add `https://<your-vercel>.vercel.app/auth/callback` and `http://localhost:5173/auth/callback` to the allowed redirect URLs.
4. Grab the URL, anon key, service role key, and JWT secret from Settings → API. Copy them into `.env`.

## Render (backend) deploy

Push to GitHub, then in Render click "New → Blueprint" and point it at this repo. Render will read `render.yaml`, create the `space-learn-api` service, and prompt you for the env vars marked `sync: false`. Set:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- `GROQ_API_KEY`
- `CORS_ORIGINS` — include your Vercel URL

The free tier spins down after 15 min of inactivity. The backend is written to that budget: single uvicorn worker, module-level singletons for httpx / Supabase / Groq clients, all async I/O, streaming responses, no background workers.

## Vercel (frontend) deploy

1. New project → import this repo.
2. Root directory → `web`.
3. Framework preset → Vite (auto).
4. Set env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (point at your Render URL, ending in `/api/v1`).
5. `web/vercel.json` handles the SPA rewrite.

## Feature flags

`.env` variables that meaningfully change behaviour:

- `USE_STUB_EMBEDDINGS=true` — inserts deterministic zero-vectors instead of calling a real embedding provider. Keeps document upload + RAG queries end-to-end runnable without an embedding key. Flip to `false` once you wire a real provider in `api/app/services/embeddings.py`.
- `GROQ_API_KEY` — when unset, the chat streams a friendly "AI not configured yet" placeholder so the UI is fully clickable.

One `.env` at the repo root serves both apps: the API points Pydantic Settings at it, and `web/vite.config.ts` sets `envDir: '..'`. Without that `envDir`, Vite would only look inside `web/` and every `VITE_*` var would silently come back undefined.

## Model tiering

One Groq key, three models — the model is chosen per request, so cheap work doesn't pay 70B latency or quota:

| Setting | Default | Used for |
|---|---|---|
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | RAG chat, quiz generation |
| `GROQ_MODEL_FAST` | `llama-3.1-8b-instant` | short, low-stakes prompts |
| `GROQ_MODEL_VISION` | `qwen/qwen3.6-27b` | image input (only vision-capable model on the account) |

Groq retires model ids periodically — confirm against `GET /openai/v1/models` before changing these.

## Quota protection

- **Per-user token bucket** (`api/app/services/ratelimit.py`) guards every LLM endpoint: 20 burst, refilling 20/min, chat costs 1 and quiz generation costs 2. In-process because Render's free tier runs a single worker; swap the storage there if that ever changes.
- **Groq 429 → `rate_limited`**, not a generic outage, so the UI tells the user to wait rather than implying the service is broken. A 401/403 from Groq maps to `not_configured` — our key is wrong, and the user can't fix that.
- Provider error bodies are logged, never surfaced: they can carry account and quota details.

## Security note

The backend uses the Supabase **service role key**, which bypasses RLS. RLS is therefore a second line of defence, not the primary one — every handler that takes a caller-supplied id must prove ownership first via `api/app/guards.py`. Adding a route that accepts a `subspace_id` or `deck_id` without an `assert_*` call reintroduces cross-user reads.

## What's not shipped in v1 (intentional)

- Billing / "Space Learn Plus" upgrade card — removed per the UX audit.
- Background reminder notifier — the preference persists but firing needs a scheduled worker the free tier won't run. Settings copy calls this out.
- Account deletion — no backend endpoint yet; Settings copy says so instead of pretending.
- Realtime co-editing on notes.
- Dark mode.

## Repo tour

- **`web/src/api/`** — the only place that talks HTTP. `client.ts` is the fetch wrapper (auth header, error envelope, network normalization). One file per resource.
- **`web/src/auth/`** — `AuthProvider` owns the Supabase session, `RequireAuth` / `RedirectIfAuthed` guards.
- **`web/src/components/ui/`** — small primitives; nothing app-specific. `Toast`, `Modal`, `ErrorBoundary`, `Input`, `EmptyState`, `Skeleton`, `ConfirmDialog`.
- **`web/src/features/`** — one folder per feature. Each folder owns its views and any local helpers.
- **`web/src/features/spaces/SpacesProvider`** — the app-level state for the sidebar's space tree. All CRUD flows here so the tree stays snappy.
- **`api/app/main.py`** — factory. Registers routers, CORS, exception handlers, and the client-shutdown lifespan.
- **`api/app/services/`** — `supabase.py` (httpx wrapper), `llm.py` (LLM Protocol + GroqLLM + StubLLM), `embeddings.py` (chunking + stub embeddings), `rag.py` (retrieve + build prompt + citation metadata).
- **`api/app/routers/`** — one file per domain. All handlers are `async` and go through the JSON error envelope.
- **`supabase/migrations/`** — timestamped, additive-only.
