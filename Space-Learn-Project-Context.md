# Space Learn: full project context for the First Review PPT

For Nandhitha. Everything about the project in one place, plus a slide-by-slide plan for the college format.
Numbers marked **(measured)** come from the project's own evaluation report (`api/eval/REPORT.md`). Do not round them up. Where something is not measured, the text says so. Honest numbers read better than inflated ones.

Live app: https://space-learn.vercel.app  |  Code: https://github.com/Abiram116/New-Space-Learn

---

## 0. The college format and how to survive it

The review asks for: Title + members (1), Introduction (2), Literature Review (2–3), Existing Methodology (2–3), Proposed Methodology (2–3), Results / Expected Results (2). Total about 11–14 slides.

It sounds like a research paper, but you do not need to fake research. Map it like this:

| College section | What to put (real, from our project) |
|---|---|
| Introduction | The problem students have, why generic AI is not enough, what Space Learn is, objectives |
| Literature Review | The real techniques and papers our system is built on (section 6 has them) and the existing apps |
| Existing Methodology | How today's tools work (ChatGPT, NotebookLM, Quizlet, Anki) and their gaps |
| Proposed Methodology | Our architecture: RAG pipeline, agents, student model, spaced repetition, free-tier engineering |
| Results / Expected Results | The real evaluation numbers (section 8) and what we expect to improve next |

Tip: lead with the problem and the live demo, not the tech stack.

---

## 1. One-paragraph summary

**Space Learn is a study assistant that answers only from a student's own notes and PDFs, shows the exact page each claim came from, and turns answers into notes, flashcards and quizzes. A "student model" watches how the student performs and adapts what to review, how to explain, and what to do next.** It runs entirely on free infrastructure (Vercel, Render, Supabase, Groq).

Short pitch (for the title slide or voice-over): *"ChatGPT knows the internet. Space Learn knows your syllabus, shows its sources, and remembers what you got wrong."*

---

## 2. The problem (Introduction slides)

1. **Generic AI answers from the whole internet.** The answer sounds sure, but a student cannot tell whether it matches what their course teaches, and in an exam the course is what counts.
2. **Hallucination.** Models invent facts and citations. Students trust fluent text.
3. **Reading is not remembering.** Research on learning (spaced repetition, testing effect) says students retain far more by being quizzed at the right time than by re-reading. Most students don't do this because it is tedious to set up.
4. **One-size-fits-all explanations.** Some students need an example first, some the theory first. Tools don't adapt.
5. **Students have no feedback loop.** Nobody tells them *which concept* they keep getting wrong or *why*.

**Objectives (use as a slide):**
- Answer only from the student's own material, with page-level citations.
- Convert material into practice (notes, flashcards, quizzes) automatically.
- Schedule reviews with a proven spaced-repetition algorithm.
- Model the student (weak topics, misconceptions, learning style) and adapt.
- Be measurable (a real evaluation, not vibes) and run at zero infrastructure cost.

---

## 3. What the app does (feature tour, good for a demo slide)

- **Subjects and Topics:** students organise material like a course (Subject > Topic).
- **Files:** upload PDF, Markdown, text, CSV, or a photo of notes (scanned pages are read by a vision model). Up to 20 MB each.
- **Chat that cites:** every claim carries a `[[n]]` marker; clicking it opens the cited passage with the text highlighted.
- **Make from chat:** one click turns an answer into a Note, a Flashcard deck, or a Quiz.
- **Flashcards:** scheduled with FSRS-5 (modern spaced repetition). Grades: Again / Hard / Good / Easy, with the next review date shown.
- **Quizzes:** multiple choice with explanations, difficulty tuned to the student, personal-best tracking, correct answers spread across A–D.
- **Notes:** a rich editor (tables, code, LaTeX maths, slash commands, "ask AI" inside a note).
- **Skills:** teaching styles a student writes (e.g. "Explain like I'm 5", "Exam cram"), switched on per topic.
- **Student model:** weak and strong topics, mix-ups, "starting to forget" topics, how you learn best.
- **Today screen (phone):** one clear daily action ("Review 12 cards, about 4 min"), streak, goal.
- **Phone = revision companion:** phones get Today, Cards, Quizzes, Notes (and adding files by camera). Chat is desktop-only on purpose.
- **Mascot bots:** four small characters (Nova, Flip, Pop, Jot), one per agent, for personality (can be turned off in Settings; hidden on phones).
- **Feedback desk:** an in-app feedback form and a password-protected admin dashboard (users, usage, funnel, written replies).

---

## 4. Architecture (Proposed Methodology)

```
Browser (React 19 SPA, Vercel)
   | JWT bearer
   v
FastAPI backend (Render, one worker, 0.1 vCPU / 512 MB)
   |-- Supabase: Auth, Postgres + pgvector (hybrid search), private file Storage
   |-- Groq API: large model (answers, quizzes, cards), small model (rewrites, verification), vision model
   '-- Local embedding model (BGE-small, ONNX) running inside the backend
```

Key design rule: **the browser never talks to the database or the AI.** Every privileged action goes through the API, which holds the credentials and checks ownership on every route (a test fails the build if a route forgets).

### The RAG pipeline (the core, one path per question)

RAG = Retrieval-Augmented Generation: fetch the relevant passages first, then make the model answer *from them*.

| Stage | What it does | Why it exists (measured where possible) |
|---|---|---|
| Read | Reads headings and pages from a PDF's fonts and layout; scanned pages go to a vision model | Citations can say "p. 4, Satisfying 2NF" instead of "chunk 17" |
| Isolate | Parses each PDF in a separate process with time and memory limits | A crafted PDF can only fail its own upload, never the server |
| Chunk | Splits by structure (stays inside a section) | Retrieved text is a coherent unit |
| Embed | BGE-small run locally, stored as half-precision vectors (`halfvec`) | No embedding API cost, half the storage, same benchmark scores |
| Resolve | Rewrites a follow-up ("which one?") into a standalone question with a small model | Follow-ups reaching the model: 83% with it vs 56% without **(measured)** |
| Search | Vector search plus keyword search, rank-fused in ONE SQL function | Without keyword search, exact-term hits fall from 92% to 80% **(measured)** |
| Judge | Decides whether the documents actually cover the question; unsure matches are passed with a warning | Unsupported answers on questions the documents don't cover: 12 of 14 without the warning, 0 of 13 with it **(measured)** |
| Answer | Streams the answer with `[[n]]` citations; source cards are sent BEFORE the first word | Student sees sources while the answer arrives |
| Verify | After streaming: fixes citation styles, removes markers that point nowhere | A citation that resolves to nothing is a broken promise |

### Agents (AI workers that produce study material)

| Agent | Workflow | What keeps it honest |
|---|---|---|
| Quiz | Plan coverage, write, check duplicates, verify each answer against its source with a second model, repair what got dropped | Questions the verifier rejects are dropped |
| Flashcards | Written from passages spread across the file, each card names its source | FSRS-5 scheduling, implemented in Python and TypeScript with a 504-case parity test |
| Notes | Writes a note from an answer, or edits inside a note | Each note records whether a person, the AI, or both touched it |
| Skills | Student-written teaching styles | Placed mid-prompt so a Skill changes *how* things are explained but can't outrank the honesty rules |

### Guardrails
- The model may only use the provided sources; with none, it must say so in one sentence.
- Prompt order is the mechanism: style rules first, student's Skill in the middle, honesty and safety rules last (models treat the last constraint as the most specific).
- Text inside an uploaded image is treated as data, never as instructions. SVG images are not accepted (they can carry script).
- The model has no tools, shell or network. A prompt injection can change what is *said*, not what is *done*.
- Foreign ids return 404 (not 403) so another user's data's existence isn't leaked.

---

## 5. The Student Model (explain this part clearly: it is the differentiator)

**What it is:** a set of estimates about each student, computed from what they actually do, used to decide what to review, how to explain, and what to suggest next. It is **not** a black-box neural network. It is transparent: each number can be explained and the student can see and reset what it learned (Settings).

### 5.1 What it observes (signals)
- Quiz answers per question (each question is tagged with the concept it tests)
- Flashcard grades (Again/Hard/Good/Easy) with timestamps
- Feedback taps on answers (useful, too long, want an example, etc.)
- Regenerate clicks, chat wording (e.g. "explain simpler"), study activity (days, cards, quizzes)
- What the student told us in onboarding (learning style, session length, goal, exam)

### 5.2 Knowledge estimation: Bayesian mastery with forgetting
- Each concept and topic has a **mastery** score from a **Beta distribution**: start from a neutral prior Beta(1,1), add evidence from every right/wrong answer and card grade.
- Evidence is **weighted by recency** (half-life of 30 days), so old results fade, which models forgetting.
- A topic counts as **weak** if mastery is below 60% with enough evidence, **strong** if above 80%. A concept needs at least 3 questions before it counts, so we don't label someone on one lucky guess.
- Also derived: **trend** (improving or falling), **"slipping"** (previously strong, now fading or unpracticed), and **recall vs application** mastery (flashcards test recall, "apply" questions test application).
- Related ideas to cite: Bayesian Knowledge Tracing (Corbett & Anderson), Ebbinghaus forgetting curve.

### 5.3 Misconceptions and prerequisites
- When the AI writes a quiz, it labels each *wrong option* with the mistake it represents (e.g. "confuses Q-learning with SARSA"). Picking that option records the misconception. The tutor can then attack that specific mix-up.
- Each question also lists up to two prerequisite concepts. If a weak concept depends on a prerequisite that is also weak, we report the **root cause** ("you struggle with backpropagation, probably because derivatives are weak").

### 5.4 Spaced repetition: FSRS-5
- Flashcards use **FSRS-5** (Free Spaced Repetition Scheduler), an open algorithm that models memory *stability* and *difficulty* per card and schedules the next review for about 90% recall probability.
- Every review is logged, and those grades also feed the mastery estimate above.
- Replaced an older SM-2-style scheduler.

### 5.5 Personalisation: learning what explanation style works
- Preferences come from four sources with trust weights: **explicit** (what you told us) 0.60, **experiment** 0.35, **feedback** 0.25, **observed behaviour** 0.10.
- A **Thompson-sampling bandit** (a reinforcement-learning style method) tries explanation styles when it doesn't yet know what works (length, depth, example-first vs theory-first) and also **teaching strategies per subject** (example-first, analogy-first, step-by-step, theory-first, code-first, Socratic). It is rewarded by the student's feedback on that exact answer, with older feedback decaying. It only reports "you learn best with X" after enough evidence.
- Why a bandit: it balances **exploring** new styles with **exploiting** what already works, without needing a big dataset.

### 5.6 Decision engine: "what should I do now?"
A simple ranked rule set that picks the next action and gives a concrete reason from real data: fix a repeated misconception, then a weak prerequisite, then a slipping topic, then due cards, then a weak topic, then continue. The Home / Today screen shows it with the reason ("you keep confusing X with Y"). Quiz difficulty is also tuned toward about **75% expected success**, the zone where people learn fastest.

### 5.7 Memory in chat
Chat keeps the recent turns plus a **rolling summary** of older turns per topic, so long conversations don't lose context while staying within token limits.

### 5.8 Honesty rules for the model of the student
- Observed habits are labelled "observed", never stated as fact.
- Everything is derived at read time from stored events, so the student can reset it.
- No invented numbers: the Home message only uses facts the app provides.

---

## 6. Literature review material (real references)

Verify each citation before putting it on a slide (details from memory; check the year and venue).

**Retrieval and RAG**
- Lewis et al., 2020. *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks.* NeurIPS. (the RAG idea)
- Cormack, Clarke, Büttcher, 2009. *Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods.* SIGIR. (how we fuse keyword and vector results)
- Xiao et al., 2023. *C-Pack* (the BGE embedding model family). (our local embedding model)

**Learning science**
- Ebbinghaus, 1885. The forgetting curve.
- Roediger & Karpicke, 2006. *Test-enhanced learning.* Psychological Science. (quizzing beats re-reading)
- Cepeda et al., 2006. *Distributed practice in verbal recall tasks.* Psychological Bulletin. (spacing)
- Bloom, 1984. *The 2 Sigma Problem.* (one-to-one tutoring is far better than classroom teaching, the motivation for AI tutors)

**Spaced repetition**
- Wozniak, 1990. SuperMemo / SM-2 (the classic algorithm behind Anki's old scheduler).
- Ye, Su, Cao, 2022. *A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling.* KDD. (the FSRS line of work)

**Student modelling**
- Corbett & Anderson, 1994. *Knowledge tracing: modeling the acquisition of procedural knowledge.* (Bayesian Knowledge Tracing)
- Piech et al., 2015. *Deep Knowledge Tracing.* NeurIPS. (neural approach; we chose a transparent Bayesian model instead)
- VanLehn, 2011. *The relative effectiveness of human tutoring, intelligent tutoring systems, and other tutoring systems.* (ITS effectiveness)

**Personalisation / bandits**
- Chapelle & Li, 2011. *An Empirical Evaluation of Thompson Sampling.* NeurIPS.

---

## 7. Existing methodology (what exists today and its gaps)

| Tool | What it does well | Gap that Space Learn fills |
|---|---|---|
| ChatGPT / general chatbots | Fluent answers on anything | Answers from the whole internet, may hallucinate, no citations to *your* course, no memory of your weak points |
| NotebookLM (source-grounded chat) | Answers from uploaded sources with citations | No spaced-repetition scheduling or student model that adapts reviews and explanation style |
| Quizlet | Flashcards and quizzes, huge library | Manual or generic cards; no grounding in your own material; weak personalisation |
| Anki | Best-in-class spaced repetition | Steep setup, you write all the cards yourself, no tutor |
| Khanmigo / intelligent tutoring systems | Adaptive tutoring | Closed content, school-oriented; not built on a student's own notes |

Methodology slide idea: show the general RAG flow as it exists (retrieve, then generate), then list its weaknesses: weak retrieval, hallucination when sources don't cover the question, unverifiable citations, no learning loop.

---

## 8. Results (use the real numbers)

All **(measured)** on our benchmark: 114 questions (direct, reworded, follow-up, exact-term, cross-section, unanswerable) over six Wikipedia PDFs, searched through the production SQL function. Re-runnable: `uv run python -m eval.report`.

**Retrieval**
| Measure | Result |
|---|---|
| Right passage ranked first | 69.4% |
| Right passage in the top five | 90.8% |
| Evidence reached the model | **93.9%** (was 72% before the retrieval rebuild) |
| All parts of a multi-part answer reached it | 91.8% |
| Search time (laptop, not the production host) | median 9.7 ms, 95th percentile 13.8 ms |

**Answers** (36-question sample, graded by a second model)
| Measure | Result |
|---|---|
| Correct | 91.7% |
| Made an unsupported claim | 8.3% |
| Refused when documents don't cover the question | 50% (weakness) |
| Citations pointing at the right passage | 67.6% (weakest number, current focus) |

**Prompt and model comparison** (18 questions each): the shorter prompt kept correctness at 88.9% and raised citations-right from 71.4% to 94.1%; the small model doubled unsupported claims, so chat stays on the large model.

**Agents:** flashcards 24 of 24 kept and sourced, 0 repeats; quiz questions 5 of 5 sound on two topics (the third topic's evaluation is incomplete; say so).

**System**
- Unit and integration tests: roughly 2,100 passing (about 870 backend and 1,250 frontend at the last run).
- A security test attacks all 46 id-taking routes as a second user and confirms no data leaks (and a database permission fix found during a pen test).
- Free-tier operation: the model provider allows 8,000 tokens a minute and 200,000 a day per model shared by everyone, which is about 2.3 to 3.2 answers a minute. We sized per-student limits (30 answers per rolling 24h), an answer cache, and a history-token budget around that.
- Engineering/perf measurements (dev machine with Render's limits simulated, so indicative): idle memory about 290 MB down to about 190 MB; upload peak 313 MB down to 226 MB; chat time-to-model-call about 600 ms down to about 200 ms (simulated database latency); landing image 209 KB down to 71 KB.

**Expected results / future work (honest framing)**
- Raise citation precision from 67.6% and the refusal rate from 50% (newest prompt changes are shipped but not yet re-measured).
- Evaluate on real lecture notes and scans, not only Wikipedia PDFs.
- Evaluate the student model with real users: does adaptive review actually raise quiz scores over time? (needs a user study; the app already collects feedback and usage)
- Load testing and monitoring on the deployed service.

---

## 9. Tech stack (one slide)

| Layer | Tech | Hosting (all free) |
|---|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS | Vercel |
| Backend | FastAPI (Python), single async worker | Render |
| Database | PostgreSQL + pgvector, row-level security | Supabase |
| Auth / storage | Supabase Auth (email, Google), private storage bucket | Supabase |
| AI | Groq-hosted LLMs (large, small, vision) | Groq free tier |
| Embeddings | BGE-small (ONNX), local in the backend | included |
| Testing | pytest, vitest; custom evaluation harness | |

Engineering highlights worth a line each: background resumable document ingestion, retry and model fallback with a circuit breaker, per-user caches that are cleared on writes, stale-while-revalidate on the frontend, security hardening (JWT checks, CSP, tenant isolation tests).

---

## 10. Suggested slide-by-slide plan (about 12 slides)

1. **Title & team.** "Space Learn: a source-grounded AI study assistant with an adaptive student model." Names: Abiram, Nandhitha (add full names, roll numbers, guide's name). Add the one-line pitch and a screenshot.
2. **Introduction (1):** the problem (section 2, points 1–3). One strong visual: a ChatGPT answer with no source vs ours with a citation.
3. **Introduction (2):** objectives + what Space Learn is (feature tour montage).
4. **Literature review (1):** RAG and retrieval (Lewis 2020, RRF, BGE).
5. **Literature review (2):** learning science + spaced repetition (testing effect, spacing, SM-2, FSRS).
6. **Literature review (3):** student modelling + bandits (BKT, DKT, Thompson sampling).
7. **Existing methodology (1):** how current tools work (table in section 7).
8. **Existing methodology (2):** their gaps (hallucination, unverifiable citations, no adaptation, setup effort).
9. **Proposed methodology (1):** architecture diagram + the RAG pipeline (section 4).
10. **Proposed methodology (2):** agents (quiz, cards, notes, skills) + guardrails.
11. **Proposed methodology (3):** the **student model** (section 5): signals, Bayesian mastery, FSRS, bandit, decision engine. Use one diagram: signals go in, estimates come out, the next action goes back to the student.
12. **Results (1):** retrieval and answer numbers (section 8 tables, 2 or 3 key numbers as big callouts: 93.9% evidence reached the model, 91.7% correct, 0 of 13 unsupported with the warning).
13. **Results (2) / Expected results:** system results (security, performance, free-tier operation) + honest limitations + future work.
14. (optional) **Live demo** screenshot strip (phone and desktop) and the QR code to the live app.

### Visual ideas
- Architecture diagram (the box diagram in section 4).
- "One study loop": upload, ask with citations, make notes, flashcards, quiz, student model, back to the start.
- Before/after bar charts: evidence reaches the model 72% to 93.9%; unsupported answers 12 of 14 to 0 of 13; memory 290 MB to 190 MB.
- Screenshots: the repo has phone screenshots in `docs/assets/phone/` and diagrams in `docs/assets/` (README images).
- A "forgetting curve with FSRS reviews" sketch for the student-model slide.

### Key points to say out loud
- "We measured it": a re-runnable benchmark, not demos.
- "Honest about weaknesses": citation precision is 67.6%; we say it and show the plan.
- "Runs for free": the whole product costs $0 in infrastructure, and was engineered around a provider limit of about 3 answers a minute.
- "The student model is transparent": every estimate has a reason, the student can see and reset it.
- "Source-grounded by design": the model must refuse rather than guess.

### Likely questions from examiners (and short answers)
- *Why not just use ChatGPT?* It answers from the internet and can't show where in *your* course; we answer from your files with page citations and refuse when the files don't cover it.
- *How do you stop hallucination?* Retrieval first, a "do the documents cover this" judge, a prompt that forbids outside knowledge, a citation verifier. Result: unsupported answers on uncovered questions fell from 12 of 14 to 0 of 13.
- *What is novel?* The combination: grounded RAG, agents that write verified practice material, and a transparent student model that feeds scheduling, difficulty and explanation style.
- *Why a Bayesian model and not deep learning (DKT)?* Small data per student, needs to be explainable and reset by the student, runs on a tiny server.
- *What is a bandit?* A method that balances trying new options with using what works, here for choosing explanation styles.
- *Limitations?* Benchmark is six Wikipedia PDFs; citation precision 67.6%; no user study yet; free-tier cold starts of about 30 seconds.

---

## 11. Who built what (for the team slide, if needed)

- **Abiram:** product direction, student model (FSRS-5 scheduling, Bayesian mastery, bandit, decision engine), performance and free-tier engineering, phone app, UI and motion design, deployment.
- **Nandhitha:** retrieval overhaul (hybrid search, layout-aware reading, follow-up resolution, coverage judging), the evaluation suite and ablations, quiz and card generation workflow, security and reliability fixes, trust pages and the feedback system, SEO, README.
(Adjust to what each of you actually did.)

---

## 12. Quick facts / links
- Live: https://space-learn.vercel.app
- Source: https://github.com/Abiram116/New-Space-Learn (MIT licence)
- Evaluation report: `api/eval/REPORT.md` (and `ABLATION.md`) in the repo
- README has the architecture diagram, the full results tables and the limitations list.
- Admin dashboard (users tried, usage, funnel, written feedback) is behind a password; it can give real "users tried / feedback" numbers for a results slide after your friends have used the app.
