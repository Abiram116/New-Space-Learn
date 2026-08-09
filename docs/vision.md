# Vision — a companion, not a tool

This is the north star every future feature gets measured against. It came
from a conversation the founder had exploring a rename (candidate: "Neura")
— **the rename is undecided and not happening now**, but the identity shift
underneath it is real and durable regardless of what the product ends up
called. Read this before scoping anything in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## The core shift

The product should not feel like a website you open and operate. It should
feel like a mentor you talk to, one who remembers what happened last time
and has an opinion about what to do next.

**Not this:**
> Upload PDF → Chat

**This:**
```
Student
  ↓
AI understands
  ↓
Creates a learning plan
  ↓
Explains concepts
  ↓
Generates notes
  ↓
Creates flashcards
  ↓
Creates quizzes
  ↓
Tracks progress
  ↓
Reminds you
  ↓
Motivates you
  ↓
Adapts difficulty
```

Every feature in the app is a spoke connected to one hub — a single AI
companion the student has an ongoing relationship with — not a menu of
independent tools that happen to share a sidebar.

## What this sounds like in practice

Re-entry, with actual memory of what happened:
> "Welcome back, Abiram. Last time we studied Dynamic Programming. You
> struggled with memoization. Shall we revise it with a quick quiz?"

Proactive, not just reactive:
> "You have an Amazon OA next week. Based on your progress, I recommend
> practicing Binary Search today instead of Arrays."

After finishing something, offering the next move instead of waiting to be
asked:
> "You've mastered Arrays. Would you like to:
> Learn Linked Lists · Revise with Flashcards · Take a Quiz · Solve 5 problems"

The naming test for whether this is working: a student should say **"I'll
ask [it]"**, not **"I'll open [it]."** That's the difference between a
character and a product — the same distinction that makes people say "ask
Claude" or "ask Siri" rather than "open Claude" or "open Siri."

## Where this already exists in the codebase (the seed to grow, not start from zero)

`GET /me/brief` (`api/app/routers/me.py`) is already the first real instance
of this pattern — it doesn't greet with "Good evening," it says something
specific to what the student actually did, grounded in real stored data
(streak, cards due, last topic touched), with a hard guard against
inventing numbers. **This is the prototype for the whole vision, not a
one-off widget.** The "Home brief as a recommendation
engine" is the most direct next step toward this — extending the brief from
one re-entry line into an actual mentor's opening move (identify a weak
area, name it, suggest the specific next action), the same shape as the
"Amazon OA next week" example above.

The context-aware-agents backlog item is the same vision applied to
mid-session moments: an agent that already knows the chat history and
what's indexed shouldn't need to ask "how many cards do you want" — it
should already know, the way a real tutor would.

## What this rules out

- Generic form-like interactions where the burden of specifying what's
  needed falls on the student ("how many questions? which topic?") instead
  of the AI inferring it from context it already has.
- Screens that only react when clicked, with no sense of what happened
  before or what should happen next.
- Copy that could belong to any study app — every message the AI sends
  should be specific to *this* student's actual history, or it isn't
  earning the "companion" framing.

## What this does not mean

Not a persona costume **as a substitute** for the real thing — forced
catchphrases or chattiness papering over a companion that doesn't actually
remember anything reads as a gimmick, not a mentor. The mechanism has to be
**real memory of real data plus a clear next-step opinion**.

Personality on top of that mechanism is fine, and worth doing — a mentor
with some character is more engaging than a neutral data-reporting voice,
as long as the personality is texture on real substance, not a cover for
its absence. Confirmed explicitly: it's fine to lean into character/voice
once the underlying data-grounding is real.

## Status

Recorded as the durable vision, not an active task. No renaming, no new
build work triggered by this note alone — it's the lens for evaluating and
prioritizing everything already in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), and for
judging any new feature proposal from here forward.
