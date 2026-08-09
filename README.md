# Space Learn

AI-powered learning platform. Subjects → Subspaces, each with AI chat that
cites your uploaded documents, notes, flashcards (SM-2 lite), quizzes, and
custom AI personas ("skills").

## Documentation

Full docs live in [`docs/`](docs/README.md):

- [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md) — how the pieces fit
  together, the data model, the AI layer, the design system.
- [**docs/IMPLEMENTATION_PLAN.md**](docs/IMPLEMENTATION_PLAN.md) — the only
  plan: what's left to build, in what order, and the definition of done
  every phase is held to.
- [**docs/setup.md**](docs/setup.md) — local dev, Supabase, Render, Vercel.
- [**docs/adr/**](docs/adr/README.md) — the settled decisions, one per file.

## Quick start

```bash
cp .env.example .env       # fill in Supabase + Groq keys
npm run dev                # starts backend + frontend together
```

See [docs/setup.md](docs/setup.md) for the full walkthrough.
