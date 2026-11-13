<div align="center">

<img src="docs/assets/readme-banner.svg" alt="Space Learn: a RAG pipeline (read, embed, retrieve, cite) feeding quiz, flashcard and note agents, shown with the app's four companion bots" width="100%" />

# Space Learn

**A study app for a student with a date.**
Answers only from your own notes and PDFs, cites the page, and bends everything
around what you're preparing for and what you keep getting wrong.

[![Live](https://img.shields.io/badge/LIVE-SPACE--LEARN.VERCEL.APP-ff5a3c?style=for-the-badge&labelColor=1e1a17)](https://space-learn.vercel.app)
[![License](https://img.shields.io/badge/LICENSE-MIT-22d3a0?style=for-the-badge&labelColor=1e1a17)](LICENSE)
[![FastAPI](https://img.shields.io/badge/FASTAPI-ASYNC-35d6e8?style=for-the-badge&labelColor=1e1a17)](api/pyproject.toml)
[![React](https://img.shields.io/badge/REACT-19-b8ff3c?style=for-the-badge&labelColor=1e1a17)](web/package.json)

</div>

A general chatbot answers the question and forgets you. Space Learn knows what
you're preparing for (an end-semester paper, GATE, a placement interview), how many
days are left, what you keep getting wrong and how you like things explained, and
writes the answers, the quiz questions and the daily plan for that.

| | |
|---|---|
| **Grounded** | Every answer cites the page it came from. A question your files don't cover is flagged, not guessed |
| **Personal** | A student model learns your weak topics from quizzes and card reviews, and aims the next explanation at them |
| **Yours to control** | Pick the mode, the strictness, or switch personalisation off. Each answer says what it was personalised with, and only what it really used |

## What you can do

- **Ask** over your own PDFs, notes and scans. A citation opens the exact passage.
- **Keep** any answer as a note (live LaTeX) or a deck of flashcards.
- **Practise** with quizzes verified against their source, and FSRS-5 flashcards.
- **Study this note**: one click writes a quiz or cards from a single note of yours.
- **Plan**: a goal and a date give a countdown, a daily plan and a readiness number.
- **Steer** with study modes (exam, GATE, interview, learning) and your own Skills.

<img src="docs/assets/readme-loop.svg" alt="One study loop: ingest, interrogate with RAG, consolidate into notes, rehearse with spaced repetition, prove with a quiz agent, with the student model in the centre shaping the next cycle" width="100%" />

## Measured, including what's weak

| | |
|---|---|
| **94.9%** | of benchmark questions had the evidence reach the model (72% before the retrieval rebuild) |
| **91.7%** | of answers judged correct on a graded sample |
| **87.5%** | of citations point at the passage that holds the evidence |
| **66.7%** | refusals on questions the files don't cover. The weakest number |
| **$0** | infrastructure. The free tier serves about 3 answers a minute, and the system is built around that |

Small samples, re-runnable with one command, kept in [one report](api/eval/REPORT.md).
What isn't measured is listed under [known limitations](docs/engineering/deep-dive.md#known-limitations).

## Why you can trust it

Guards live in code, not the prompt. Every route that takes an id proves ownership, and
a test sweeps them all. PDFs are parsed in a separate process with time and memory limits.
Citations are repaired after the stream, and each cited sentence is scored against its
source ("2 of 3 claims found in your files"). Free-tier limits (30 answers a day, a
short burst, a cache that never crosses students) are shown in Settings with today's use.

## Stack

**AI** Groq (`gpt-oss-120b`, `gpt-oss-20b`, a vision model), local BGE-small embeddings ·
**Backend** FastAPI, Pydantic v2 · **Data** Supabase (Postgres + pgvector, Auth, Storage) ·
**Frontend** React 19, TypeScript, Vite, Tailwind v4, Tiptap, KaTeX ·
**Tests** 1,143 backend, 1,683 frontend

## Run it

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAbiram116%2FNew-Space-Learn&root-directory=web&project-name=space-learn)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Abiram116/New-Space-Learn)

```bash
git clone https://github.com/Abiram116/New-Space-Learn.git && cd New-Space-Learn
cp .env.example .env       # Supabase and Groq keys (both free)
npm run db:push            # apply the database migrations
npm run dev                # backend and frontend together
```

Needs Node.js (LTS) and Python 3.11–3.12. Full walkthrough: [`docs/operations/setup.md`](docs/operations/setup.md).

## Go deeper

[Deep dive](docs/engineering/deep-dive.md) (pipeline, agents, evaluation tables, every decision with its cost) ·
[architecture](docs/engineering/architecture.md) ·
[AI pipeline](docs/engineering/ai-pipeline.md) ·
[personalisation](docs/engineering/personalization.md) ·
[security](docs/engineering/security.md) ·
[decisions](docs/decisions.md) ·
[evaluation report](api/eval/REPORT.md)

Chat is desktop-only for now; phones get notes, flashcards and quizzes. MIT, see [LICENSE](LICENSE).
