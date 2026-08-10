# Decisions

The choices that shaped this codebase, one line of reasoning each.

This replaced a folder of thirteen Architecture Decision Records. The ADR
format — context, alternatives, consequences, status, one file per decision —
is built for teams where the people who made a choice will be gone when it is
questioned. This is two people on a capstone. The ceremony cost more than it
returned, but the *reasons* still matter: without them, someone re-litigates
"why not a vector database" every few weeks. So the reasons are here and the
paperwork isn't.

Rejections are recorded as deliberately as the adoptions. The point of the
list is to stop settled arguments restarting.

---

## Data model

**Subject → Subspace, not an auto-organized knowledge graph.**
A student already knows their own course structure; making them discover it
in a graph is work with no payoff. Cross-topic links exist as an explicit,
opt-in "Linked Subspaces" layer on top, so a relationship is something they
asserted rather than something a model guessed.

**A "concept" is a normalized tag, never a row.**
`normalize(t) = trim(t).lowercase()` on artifacts that already exist. No
`concepts` table, no `concept_edges`. Relationships are computed with
`GROUP BY` at read time. A stored graph would need writing, migrating,
garbage-collecting and reconciling with the tags it duplicated — for a
projection that is cheap to derive on demand at this data volume.
*Revisit when:* a single user's tag count makes read-time aggregation slow
enough to measure. Not close.

**The Gap Map is drawn, not stored.**
Nodes are normalized tags, edges come from confusion evidence, and the whole
thing is assembled per request. Follows directly from the decision above.

**Notes are markdown strings, not editor JSON.**
Tiptap is the editor; `notes.body_md` stays markdown, converted at the editor
boundary. ProseMirror JSON would lock the content to one editor version and
make every note unreadable outside the app.
*Cost of this choice:* the markdown round-trip is a real source of bugs —
escaped HTML has bitten this twice. See `healHtml.ts`.

---

## AI

**One provider, three model tiers.**
Groq, one key. A 70B model for reasoning, an 8B for template-filling, a
vision model for images. Paying 70B latency and quota for work an 8B handles
is the easiest waste to avoid, and one provider means one thing to be down.

**Embeddings run locally: BGE-small-en-v1.5, quantized ONNX.**
No API key, no second provider account, $0 marginal cost. Measured at
~170–200 MB loaded and ~230 MB peak, against Render free tier's 512 MB —
roughly 40–50% headroom. **BGE-M3 was evaluated and rejected for
production:** its weights alone are ~2.2 GB, four times the entire memory
ceiling. It is kept only as an offline quality benchmark.
*Revisit when:* the memory ceiling is lifted, or retrieval quality is
measured as the actual bottleneck.

**A model may propose; it may never assert.**
Every relationship and every claim the app makes about a student traces to a
specific stored row. This is what makes the product's central promise
inspectable rather than a matter of trust, and it is why citations are
validated server-side before they are persisted.

---

## Backend

**Service-role key plus explicit application guards; RLS as defence in depth.**
Handlers call `assert_subspace` / `assert_space` / `assert_deck` before
touching any caller-supplied id. RLS stays enabled on every table.
*The risk this accepts:* a missed guard is a silent cross-user leak rather
than a loud database error. That is why `test_guard_coverage.py` fails when a
new endpoint forgets one — the discipline is enforced by a test, not by
memory.

**A hand-rolled httpx wrapper instead of `supabase-py`.**
One module-level `AsyncClient` for pooling, with helpers for select / insert /
update / delete / rpc, storage, and JWT verification. Measurably smaller
memory footprint on a 512 MB instance, which is the reason free tier works at
all.
*Revisit when:* the RAM ceiling lifts enough that SDK convenience outweighs
maintaining this.

**Documents process inline, bounded by a 25-second budget.**
No job queue, no worker, nothing to operate. Over budget, the document stays
`processing` with a message pointing at `reprocess`, which resumes the work.
*This budget is load-bearing* — it is what the embedding warm-up exists to
protect. See `embeddings.warm_provider`.

**Skills and Agents are different things and must look different.**
Skills are persistent personalities attached to a topic; Agents are one-shot
actions that make you something and finish. They were briefly listed
together, which is exactly why nobody could tell them apart.

---

## Frontend

**SM-2-lite, deliberately implemented twice.**
`ease` (floor 1.3), `interval_days`, `reps`, four grades. The algorithm runs
in Python *and* TypeScript so grading can be optimistic — the next interval
shows instantly instead of after a round trip.
*The risk this accepts:* two implementations can drift. A parity test runs
the real `schedule.ts` over 480 cases against the Python and fails if they
ever disagree.
