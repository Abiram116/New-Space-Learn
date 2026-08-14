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
[../engineering/architecture.md](../engineering/architecture.md#missing-configuration-never-crashes-the-app).

**One `.env` at the repo root serves both apps.** The API points Pydantic
Settings at it directly; `web/vite.config.ts` sets `envDir: '..'` so Vite
looks one directory up instead of only inside `web/`. Without that setting,
every `VITE_*` variable would silently come back `undefined` — this bit us
once already, so it's called out here deliberately.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. **Apply migrations with the CLI**, not the dashboard SQL Editor.

   The SQL Editor's tabs live in *your browser's* local storage — they are
   not stored in the project and a collaborator cannot see them. That is why
   this repo keeps every schema change as a file in `supabase/migrations/`
   and applies it from the terminal: the migration is the shared artifact,
   the dashboard is not.

   The CLI is pinned as a dev dependency (`npm i` at the repo root installs
   it), so nobody needs a global binary and everyone runs the same version.

   ```bash
   npx supabase login                       # opens a browser once
   npx supabase link --project-ref <ref>    # <ref> is in your project URL
   npm run db:list                          # local vs remote — read this first
   npm run db:push                          # applies everything not yet applied
   ```

   **Read `db:list` before you push.** It prints every migration with a
   `Local` and a `Remote` column. The CLI decides what to apply by reading
   `supabase_migrations.schema_migrations` on the remote — so any migration
   that was applied *by hand* in the SQL Editor is invisible to it, shows a
   blank `Remote`, and `db:push` will try to run it a second time. Most of
   these files are not idempotent (`create table` without `if not exists`),
   so that fails partway and leaves you guessing.

   Fix it by telling the CLI what is already there, once, per version:

   ```bash
   npx supabase migration repair --status applied 20260803120000
   ```

   That only writes a bookkeeping row; it runs no SQL against your schema.
   Repeat for each migration that is genuinely already applied, then
   `db:list` again — every old one should show in both columns, and only
   genuinely new work should remain to push.

   What the base migrations do, if you need to reason about them:
   - The first enables `pgvector` and `pgcrypto`, creates every table, and
     inserts a private Storage bucket named `documents`.
   - The second enables RLS on every table and pins ownership to
     `auth.uid()`.
   - The third installs the `match_document_chunks` RPC (used by RAG) and
     seeds four library Skills every user can add to their space.
   - Later ones are additive (widening a check constraint, changing the
     embedding vector width, and so on).

   To write a new one: `npm run db:new -- some_change_name` creates a
   correctly-timestamped empty file in `supabase/migrations/`. Commit it in
   the same PR as the code that needs it.

   If the dashboard's GitHub integration is also connected, pick one or the
   other. Running both means a migration can be applied twice — once on push
   to `main`, once by whoever runs `db:push` locally.
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

## Tests

Both suites are fast enough to run on every change — there is no reason to
push without them.

```bash
# Backend — 237 tests (count as of the 2026-08 hardening pass; grows over time)
cd api && uv run --extra dev pytest -q

# Frontend — 255 tests (same caveat)
cd web && npm test

# Lint (must be clean; B008 is ignored deliberately, see api/pyproject.toml)
cd api && uv run --extra dev ruff check .
```

**What is covered, and why those things.** The suites are small and aimed at
the places where a bug is silent rather than loud:

- `guards` and `test_guard_coverage` — the coverage test **fails when a new
  endpoint forgets an ownership check**, which is the failure mode that
  actually shipped once. This is the single highest-value test in the repo.
- `sm2` plus `sm2_parity.mjs` — SM-2 is implemented twice, in Python and
  TypeScript, so the review screen can preview an interval without a round
  trip. The parity test runs the real `schedule.ts` over 480 cases and fails
  if the two ever disagree.
- `chunking` — a real infinite loop shipped here and hung document uploads.
- `note_html_demotion`, `healHtml` — escaped HTML reached a student's note
  twice; these pin both the repair and, just as importantly, that clean notes
  are left alone.
- `citations` — a citation marker pointing at a source that does not exist is
  a broken promise, so out-of-range markers are stripped before saving.
- `format`, `slashMenu`, `schedule` — the pure logic behind the notes list and
  editor, which is the part that is cheap to test and easy to break.

**Write tests that can fail.** When adding one, break the implementation on
purpose and confirm the test goes red. A test written against redundant code
passes for the wrong reason — that happened here: a `notePreview` test looked
like it guarded against base64 image previews, but `stripMarkdown` was
already handling images, so the line it was "protecting" was dead code. The
mutation check is what found it.
