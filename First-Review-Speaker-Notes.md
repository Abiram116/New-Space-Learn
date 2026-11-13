# Space Learn: First Review speaker notes

Fifteen slides, about 12 minutes at a steady pace. The same text is in the deck's speaker notes.

## Who speaks

| Slides | Section | Speaker |
|---|---|---|
| 1–3 | Title and Introduction | Abiram |
| 4–6 | Literature review | Nandhitha |
| 7–9 | Existing methodology | Abiram |
| 10–12 | Proposed methodology | Nandhitha |
| 13–14 | Results and expected results | Abiram |
| 15 | Close, then questions (both) | Nandhitha |

Each handover is written into the last line of the section, so the next speaker is introduced by name.

## Slide 1. Title

**Speaker:** Abiram · about 50 seconds

Good morning. I am Abiram, this is Nandhitha, and our project is Space Learn. I want to start with one line from the research we build on: “Testing is a powerful means of improving learning, not just assessing it.” That is Roediger and Karpicke, 2006. Students today have AI that can answer anything. But getting an answer is not the same as learning it. Space Learn is a study assistant that answers only from the student’s own notes and PDFs, shows the exact page each claim came from, turns those answers into notes, flashcards and quizzes, and adapts to what the student keeps getting wrong. Four ideas carry it: retrieval-augmented generation, AI agents, a student model, and spaced repetition.

**If asked:** The numbers on the banner are our own measurements; we explain them on the results slide.

## Slide 2. Introduction: the problem

**Speaker:** Abiram · about 60 seconds

There are three problems we set out to solve. First, students already study with general AI. In a 2025 survey of UK undergraduates, 92 percent use AI tools, and 88 percent use them for assessed work. But those tools answer from the whole internet, not from what this course teaches, and the course is what the exam marks. Second, these models make things up. One study asked ChatGPT for literature reviews and checked every citation: 55 percent of GPT-3.5’s citations and 18 percent of GPT-4’s did not exist. And the student has no page to check the answer against. Third, reading is not remembering. Being tested at the right time works far better than re-reading, yet in a survey of students 84 percent re-read and only 11 percent test themselves, because setting it up by hand is tedious.

**If asked:** The survey is HEPI 2025, 1,041 UK students. The citation study is Walters and Wilder, Scientific Reports 2023, 636 citations, on 2023 models. A real case outside classrooms: Mata v. Avianca, New York, June 2023, lawyers fined 5,000 dollars for filing six court cases ChatGPT invented. The study-habits survey is Karpicke, Butler and Roediger, 2009.

## Slide 3. Introduction: one study loop and objectives

**Speaker:** Abiram · about 45 seconds

So our answer is one study loop instead of five separate tools. You ingest your files. You ask questions and get answers with page citations. You save a good answer as a note. You rehearse it with spaced-repetition flashcards. And you prove it with a quiz. In the middle sits the student model, which reads every result and shapes the next round. That gives us five objectives: answer only from the student’s material with citations; turn answers into notes, flashcards and quizzes; schedule reviews with proven spaced repetition; model each student’s weak spots and adapt; and measure all of it, at zero infrastructure cost. Nandhitha will now take you through the research behind this.

**If asked:** Each objective maps to a later slide: 1 to the RAG pipeline, 2 to the agents, 3 and 4 to the student model, 5 to the results.

## Slide 4. Literature review: retrieval

**Speaker:** Nandhitha · about 45 seconds

Thank you. Our literature review has three parts, and the first is retrieval. The core idea is Retrieval-Augmented Generation, from Lewis and colleagues in 2020: first fetch the relevant passages, then let the model generate from them. That is how our chat answers from the student’s own files instead of from memory. The second paper is Reciprocal Rank Fusion, from 2009. It is a simple way to merge two ranked lists, and we use it to combine search by meaning with search by keyword. The third is the BGE family of compact embedding models. We run the small one inside our own server, so there is no embedding service to pay for.

**If asked:** An embedding turns text into a list of numbers so that similar meanings sit close together. Ours has 384 numbers per passage. RRF scores a passage as 1 divided by (60 plus its rank) in each list and adds the two; 60 is the constant from the original paper.

## Slide 5. Literature review: learning science

**Speaker:** Nandhitha · about 45 seconds

The second part is learning science, and it explains why the app makes quizzes and flashcards at all. Ebbinghaus showed in 1885 that memory fades quickly unless it is refreshed. That is the dashed line on the chart. Roediger and Karpicke showed that being tested beats re-reading. Cepeda and colleagues showed that spacing practice out beats cramming. Put together, you get the green line: each review lifts recall back up, and afterwards it fades more slowly. The last line is about scheduling. SM-2 is the classic fixed formula from the 1980s. FSRS, from 2022, instead models each card’s own memory. We use FSRS version 5.

**If asked:** The chart is an illustration of the idea, not our measured data. FSRS tracks two things per card: stability, how long the memory lasts, and difficulty. Our implementation is checked against the reference with 504 test cases.

## Slide 6. Literature review: modelling the student

**Speaker:** Nandhitha · about 50 seconds

The third part is modelling the student. Bloom’s 2 Sigma result from 1984 is the motivation: students with a one-to-one tutor far outperform a normal classroom. An AI tutor is a way to give that to everyone. Bayesian Knowledge Tracing estimates what a student knows from their right and wrong answers. Our mastery model follows that idea. Deep Knowledge Tracing is the neural network version. We chose not to use it: one student gives very little data, and we want every estimate to be explainable to that student. And Thompson sampling is a method for balancing trying new options with using what already works. We use it to learn which explanation style suits each student. Abiram will now show how students study today.

**If asked:** Why Bayesian and not deep learning: little data per student, estimates must be explainable and resettable, and it must run on a small free server.

## Slide 7. Existing methodology: today's tools

**Speaker:** Abiram · about 45 seconds

This is how students study with AI today. Each tool does one step well. ChatGPT and similar chatbots give fluent answers on anything, but from the internet, sometimes invented, with no page from your course. NotebookLM does answer from your own sources with citations, but it has no spaced practice and no model of what you keep getting wrong. Quizlet gives flashcards and quizzes, but they are generic or made by hand, not built from your material. Anki has excellent spaced repetition, but you write every card yourself and there is no tutor. So each covers one step. None connects your material, a grounded answer, practice and feedback in one loop. That loop is our project.

**If asked:** Closest competitor is NotebookLM. Our difference: it stops at the answer; we continue into verified practice material, scheduling and a student model.

## Slide 8. Existing methodology: a plain RAG pipeline

**Speaker:** Abiram · about 45 seconds

Underneath most of these tools is a plain RAG pipeline with four steps: take the question, turn it into an embedding, fetch the top few passages by similarity, and let the language model answer. It is simple, and it fails in four ways. A follow-up like “which one?” is searched exactly as written, so it finds nothing useful. Exact terms and codes are missed, because search by meaning alone is fuzzy. The top results are passed to the model even when none of them answer the question, so the model guesses. And citations are never checked, so they can point at nothing. Each of these four failures is something we built a stage for.

**If asked:** Top-k means the k most similar passages. A plain pipeline usually takes about 3 to 5 and sends them straight to the model.

## Slide 9. Existing methodology: four gaps

**Speaker:** Abiram · about 40 seconds

So these are the four gaps, and how we close each one. Weak retrieval: we rewrite follow-ups into full questions, and we fuse meaning search and keyword search in one query. Guessing: a coverage judge checks whether the files actually cover the question, and if not, the model must say so instead of answering. Citations you cannot check: every claim is marked with its source, and one click opens the exact passage. And no learning loop: every answer can become notes, cards and quizzes, and the results feed a student model. Nandhitha will now explain how we built this.

**If asked:** The coverage judge is not another AI call. It is two measured thresholds on how close the best passage is and how much of the question’s wording it shares, fitted on a separate set of tuning questions.

## Slide 10. Proposed methodology: architecture and RAG pipeline

**Speaker:** Nandhitha · about 70 seconds

This is our architecture. The browser is a React app. It never talks to the database or the AI model directly. Everything goes through our FastAPI server, which holds every key and checks on every route that the data belongs to the person asking. Behind it are Supabase, which is Postgres with vector search, and Groq, which runs the language models. Below is the path of one question, in seven stages. Read and Embed happen once, when a file is uploaded: we keep the headings and page numbers, and scanned pages go through a vision model. Then for every question: Resolve rewrites a follow-up as a full question. Search takes the top 20 passages by meaning and the top 20 by keyword and fuses them. Judge asks whether the files cover the question. Answer sends the best six passages to the model, which streams a reply with a source on each claim. And Verify checks the citations afterwards: a marker that points nowhere is removed, and a marker on the wrong source is moved to the right one.

**If asked:** Top-k: 20 candidates from each search, fused with RRF constant 60 and keyword weight 0.5, then at most 6 passages within 4,200 characters go to the model. Embedding model: BGE-small, 384 dimensions, stored at half precision to save space. Uploads are processed in a separate process with time and memory limits, so one bad PDF cannot take the server down.

## Slide 11. Proposed methodology: agents

**Speaker:** Nandhitha · about 60 seconds

Answers alone do not make a student learn, so three agents turn them into practice. The strip at the top follows one lecture PDF: it becomes a chat answer, then a note, then flashcards, then a quiz, and the student model reads the result. The quiz agent is a workflow, not a single prompt. It plans which parts of the file to cover, writes the questions, drops repeats, and then a second model checks every marked answer against its source. The flashcard agent makes cards from across the whole file. Each card names the passage it came from, and it is scheduled with FSRS-5. The notes agent writes or edits notes, and records whether a person, the AI, or both wrote each one. All three work under the same guardrails: only the given sources; the honesty rules come last in the prompt, so a custom teaching style cannot override them; text inside an uploaded image is treated as content, never as an instruction; and the model has no tools and no network access.

**If asked:** An agent here means a multi-step workflow where the model’s output is checked before the student sees it. “Image text is never an instruction” is our defence against prompt injection.

## Slide 12. Proposed methodology: the student model

**Speaker:** Nandhitha · about 60 seconds

This is the part that makes Space Learn more than a chatbot: the student model. On the left are the signals: quiz answers tagged by concept, flashcard grades, feedback on answers, and what the student told us directly. In the middle are the estimates. Mastery is a Bayesian estimate for each concept. It starts neutral, and older evidence fades with a 30-day half-life, which models forgetting. Below 60 percent is weak, above 80 is strong, and a concept needs at least three questions before we judge it. We also track which ideas a student mixes up, and likely root causes. And a Thompson-sampling bandit learns which explanation style works. On the right are the decisions: the next step with its reason, which cards are due, quizzes aimed at about 75 percent success, and how the tutor explains. The bars at the bottom show how much we trust each kind of evidence: what the student told us most, then experiments, then feedback, then observed behaviour. Every estimate can be explained to the student and reset by them. Abiram will show the results.

**If asked:** Beta(1,1) means we start with no opinion: 50 percent. Trust weights: explicit 0.60, experiment 0.35, feedback 0.25, observed 0.10, and observed evidence can never rise above 0.75. Why 75 percent success: hard enough to learn from, easy enough not to discourage.

## Slide 13. Results: first run

**Speaker:** Abiram · about 60 seconds

These are the results of our first run. They are measured, not estimated. We built a benchmark of 114 questions over six PDFs, of six kinds: direct, reworded, follow-ups, exact terms, questions that need two sections, and questions the files do not answer. It runs through the same search function the live app uses. First number: the evidence reached the model for 93.9 percent of questions. Before we rebuilt retrieval it was 72 percent. Second: on a graded sample of 36 answers, 91.7 percent were judged correct. Third: for questions the files do not cover, unsupported answers fell from 12 out of 14 to 0 out of 13 after we added the coverage warning. The table is an ablation: we remove one stage and measure what is lost. Without the follow-up rewrite, follow-ups reaching the model drop from 83 to 56 percent. Without keyword search, exact terms drop from 92 to 80. This is a first run. The full grading and real lecture notes come next.

**If asked:** We did not use RAGAS. It is our own benchmark: retrieval is checked against exact quotes from the documents, so it needs no AI judge and is repeatable; answers are graded by a second model against a reference answer. Other numbers: right passage ranked first 69.4 percent, in the top five 90.8 percent, search time about 10 milliseconds on a laptop.

## Slide 14. Results: limits and expected results

**Speaker:** Abiram · about 50 seconds

We also want to be clear about our limits. Our two weakest numbers today: 67.6 percent of citations point at exactly the right passage, and the system refuses only 50 percent of the time when the files do not cover a question. Stricter rules for both are already built, and we will re-measure them on the same benchmark. So our expected results for the next review are: higher citation precision and refusal rate; an evaluation on real lecture notes and scanned pages; a user study on whether adaptive review actually raises scores; and load testing and monitoring in production. All of this runs at zero infrastructure cost, built around a free model limit of about three answers a minute, and it is backed by 2,353 automated tests, all passing.

**If asked:** The benchmark documents are six Wikipedia articles, not real course notes yet. The free limit is shared by all users, so we added a limit of 30 answers per student per day, an answer cache, and a budget on chat history. Tests: 1,457 frontend and 896 backend.

## Slide 15. Thank you

**Speaker:** Nandhitha · about 20 seconds

To close with one line: ChatGPT knows the internet. Space Learn knows your syllabus, shows its sources, and remembers what you got wrong. We will show a live demo at the end of the month. Thank you. We are happy to take your questions.

**If asked:** Why not just ChatGPT? It answers from the internet and cannot show where in your course; we answer from your files with page citations. What is novel? The combination: grounded answers, agents that make checked practice material, and a transparent student model. Limitations? A small benchmark, citation precision of 67.6 percent, no user study yet, and a cold start of about 30 seconds on the free host.
