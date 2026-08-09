# Setup & deploy

## Local development

One combined command starts both apps together:

```bash
cp .env.example .env       # fill in Supabase + Groq keys as you get them
npm run dev                # from the repo root — starts backend + frontend
```

That script (`scripts/dev.sh`) validates your `.env` has the required keys,
checks both ports are free before starting anything, and tears down both
processes cleanly on Ctrl+C. If you'd rather run them separately:

```bash
# Frontend — http://localhost:5173
cd web && npm install && npm run dev

# Backend — http://localhost:8000
cd api && uv sync && uv run uvicorn app.main:app --reload --port 8000
```

Nothing else is required. If a key is missing, the feature that needs it
degrades to a friendly placeholder instead of erroring — see
[ARCHITECTURE.md](ARCHITECTURE.md#missing-configuration-never-crashes-the-app).

**One `.env` at the repo root serves both apps.** The API points Pydantic
Settings at it directly; `web/vite.config.ts` sets `envDir: '..'` so Vite
looks one directory up instead of only inside `web/`. Without that setting,
every `VITE_*` variable would silently come back `undefined` — this bit us
once already, so it's called out here deliberately.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. **Link the GitHub repo**: Dashboard → Database → Migrations → connect
   this repo. In practice, this integration only reacts to *new* pushes
   after it's connected — it won't retroactively run migrations that were
   already in the repo when you connected it. If you connect it after the
   fact, apply the existing migrations manually once via the SQL Editor:
   paste each file in `supabase/migrations/`, in filename order, and run
   them one at a time.
   - The first migration enables `pgvector` and `pgcrypto`, creates every
     table, and inserts a private Storage bucket named `documents`.
   - The second migration enables RLS on every table and pins ownership to
     `auth.uid()`.
   - The third migration installs the `match_document_chunks` RPC (used by
     RAG) and seeds four library Skills every user can add to their space.
   - Later migrations are additive (e.g. widening the tone-color check
     constraint) — apply them the same way.
3. **Google OAuth**: Dashboard → Authentication → Providers → Google. Paste
   the client id/secret from Google Cloud Console. Add
   `https://<your-vercel>.vercel.app/auth/callback` and
   `http://localhost:5173/auth/callback` to the allowed redirect URLs.
4. **Grab your keys** from Settings → API:
   - **Project URL** — the *bare* URL (`https://xxxxx.supabase.co`), not the
     `/rest/v1/` suffixed version some dashboard pages show. Goes into both
     `SUPABASE_URL` and `VITE_SUPABASE_URL`.
   - **Publishable key** (formerly "anon key") → `VITE_SUPABASE_ANON_KEY`.
     Safe for the browser.
   - **Secret key** (formerly "service_role key") → `SUPABASE_SERVICE_ROLE_KEY`.
     Backend only — **never** put this in a `VITE_*` variable; Vite bakes
     those straight into the client bundle.
   - **JWT secret**, from the separate "JWT Keys" page → `SUPABASE_JWT_SECRET`.
     Lets the backend verify a session locally without a network round-trip.
     If your project uses the newer asymmetric signing keys instead of the
     legacy shared secret, local verification fails silently for a valid
     token — the backend falls back to a network verify (`/auth/v1/user`)
     automatically in that case, so this is handled, not a thing to debug.

## Groq (LLM)

Get a key at [console.groq.com](https://console.groq.com) → API Keys — no
credit card required for the free tier. Put it in `GROQ_API_KEY`. Leaving it
blank is fine during early development; chat streams a placeholder reply
instead of failing.

## Render (backend) deploy

Push to GitHub, then in Render click "New → Blueprint" and point it at this
repo. Render reads `render.yaml`, creates the `space-learn-api` service, and
prompts for the env vars marked `sync: false`:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- `GROQ_API_KEY`
- `CORS_ORIGINS` — include your Vercel URL

## Vercel (frontend) deploy

1. New project → import this repo.
2. Root directory → `web`.
3. Framework preset → Vite (auto-detected).
4. Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`
   (your Render URL, ending in `/api/v1`).
5. `web/vercel.json` already handles the SPA rewrite.

## Verifying everything works

```bash
# Frontend
cd web && npx tsc -b --noEmit && npm run build

# Backend
cd api && uvx ruff check app/ --select F,E9
uv run python -c "from app.main import app; print(len(app.routes))"

# Live check
curl http://localhost:8000/api/v1/health
# → {"ok":true,"supabase":true,"llm":true}
```

If `supabase` or `llm` come back `false`, the corresponding keys aren't
being read — check they're in the root `.env`, not `web/.env` or `api/.env`.
