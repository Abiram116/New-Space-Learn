# Review demo: five minutes, one student

One story, in this order. Every step below is something the app really does; none of it needs a model call beyond the chat turns marked **(AI)**.

**Before you start:** `npm run dev`; real embeddings on (`USE_STUB_EMBEDDINGS=false`); one topic with a real PDF already processed; a goal and exam date set. Ask one question beforehand so the first answer is not a cold start.

## 1. The pitch (30 s)
"A general chatbot answers and forgets you. This one knows I have an exam in N days and what I keep getting wrong." Open **Home**: the countdown reads "Your exam · N days", with a **readiness** number (from quizzes and card reviews, and how many topics it is based on), and the cards due spread across the days left. The things to do about it are in Up next, right below. Nothing there is generated; it is arithmetic over my own data.

## 2. Say what you are preparing for (30 s)
Click **change** on the countdown. Pick **Interview prep**, edit the goal, set a date, Save. Point out that the goal text you typed at sign-up suggested the mode ("looks right").

## 3. Ask in that mode (60 s) **(AI)**
Open the topic and ask about a concept from the PDF. Under the answer:
- **Made for you**: kept to your files, read in the subject's sense, tuned for interview prep, the weak spot it aimed at, the files it cited.
- **Checked against your files**: "N of M claims found in them". Open a source to show the citation lands on the page.

Switch the mode to **Just learning** (Settings › Learning, or Home) and ask again: a different answer, and a different "Made for you" line.

## 3b. The mock round (45 s) **(AI)**
In interview mode, click the first starter, "Interview me on this, one question at a time". Answer badly on purpose. It critiques the answer from the file before the next question.

## 4. Control and guardrails (60 s)
- Ask something outside the topic: it stays in scope and says so.
- Settings › Learning: **Make answers mine** off. Ask again: the same files and scope, no personal shaping, and the line under the answer drops the personal parts.
- **Try that again** on an answer: the old one is replaced, not stacked.

## 5. Evidence (45 s)
Open `api/eval/REPORT.md`: 94.9% of questions get the evidence to the model, 91.7% of answers judged correct, 87.5% of citations on the evidence (it was 67.6% before the marker fix: the story of finding a stale number). Then the student-notes table: passages in shorthand are found well, but "this isn't in your notes" is weaker (60% against 87.5%), and say so first. Then the limitation you will be asked about: web search is left out on purpose (free-tier limits, and it weakens answers-from-your-files).

## If the model is busy
The thread says the tutor is busy, the question is saved, and offers **Review due cards** and **Read your notes**, which need no model. Say that is deliberate: the free tier is about three answers a minute.
