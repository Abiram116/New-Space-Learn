# Space Learn

AI-powered learning platform. Subjects → Subspaces, each with AI chat that
cites your uploaded documents, notes, flashcards (SM-2 lite), quizzes, and
custom AI personas ("skills").

## Documentation

Full docs live in [`docs/`](docs/README.md):

- [**docs/architecture.md**](docs/architecture.md) — how the pieces fit
  together, the data model, the AI layer, the design system.
- [**docs/setup.md**](docs/setup.md) — local dev, Supabase, Render, Vercel.
- [**docs/retrospective.md**](docs/retrospective.md) — lessons from building
  this, and the standing checklist every feature is held to.
- [**docs/backlog.md**](docs/backlog.md) — open, unscheduled product ideas.

## Quick start

```bash
cp .env.example .env       # fill in Supabase + Groq keys
npm run dev                # starts backend + frontend together
```

See [docs/setup.md](docs/setup.md) for the full walkthrough.
