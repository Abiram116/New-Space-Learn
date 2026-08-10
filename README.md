# Space Learn

AI-powered learning platform. Subjects → Subspaces, each with AI chat that
cites your uploaded documents, notes, flashcards (SM-2 lite), quizzes, and
custom AI personas ("skills").

## Documentation

Full docs live in [`docs/`](docs/README.md):

- [**docs/engineering/architecture.md**](docs/engineering/architecture.md) — how the pieces fit
  together, the data model, the AI layer, the design system.
- [**docs/plan.md**](docs/plan.md) — the only
  plan: what's left to build, in what order, and the definition of done
  every phase is held to.
- [**docs/operations/setup.md**](docs/operations/setup.md) — local dev, Supabase, Render, Vercel.
- [**docs/decisions.md**](docs/decisions.md) — why the big choices were made,
  including what was rejected.

## Quick start

```bash
cp .env.example .env       # fill in Supabase + Groq keys
npm run dev                # starts backend + frontend together
```

See [docs/operations/setup.md](docs/operations/setup.md) for the full walkthrough.
