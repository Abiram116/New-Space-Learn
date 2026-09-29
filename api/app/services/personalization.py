"""The context-building layer: what each task needs to know about the student,
and nothing else.

Before this, six consumers — chat, quiz generation, flashcards, the notes agent,
inline `/ai` and the Home brief — all called
`student_model.format_for_prompt(await student_model.get(user_id))` and got the
**same block**. Chat paid tokens for streak counts and cold-topic lists it
cannot act on; quiz generation was told the student's preferred tone, which
changes nothing about a multiple-choice question. Every consumer got everything
and used a fraction.

So the shape here is one function per task, each returning a small block. The
budget is ~6 lines. If a block grows past that, the question to ask is which
line is actually going to change the output, not how to fit more in.

**One snapshot per request.** `build()` is the single entry point and does the
read pass once; nothing downstream re-reads. That matters because the previous
arrangement had `/me/brief` fetching `quiz_results`, `daily_activity` and
`subspaces` twice apiece for one render.
"""

from __future__ import annotations

from typing import Literal

from . import preferences, student_model, style_bandit
from .preferences import Preference
from .student_model import Snapshot

Task = Literal["chat", "quiz", "cards", "notes", "brief"]


async def build(user_id: str, task: Task, *, subspace_id: str | None = None) -> str:
    """The personalization block for one task. Empty string when there is
    nothing real to say — never padded with generic filler, because a vague
    block is an instruction to invent a student."""
    snap = await student_model.snapshot(user_id)
    return render(snap, task, subspace_id=subspace_id)


def render(snap: Snapshot, task: Task, *, subspace_id: str | None = None) -> str:
    """The pure half of `build`, so callers that already hold a snapshot (the
    brief does) don't pay for a second read pass."""
    prefs = preferences.resolve(snap)
    lines = _DISPATCH[task](snap, prefs, subspace_id)
    if not lines:
        return ""
    return "What you know about this student:\n" + "\n".join(f"- {ln}" for ln in lines)


async def render_chat(
    snap: Snapshot, subspace_id: str | None, user_id: str
) -> tuple[str, list[str], dict[str, str]]:
    """`render(snap, "chat", ...)`, plus `style_bandit`'s Thompson-sampled
    experiments filling in any of the three style dimensions with nothing
    actionable yet.

    Chat is the only task this runs for, and the only place `style_bandit`
    is invoked at all: quiz/cards/notes/brief render once and leave nothing
    a later feedback tap can point back at, while a chat message has an
    `id`, so `response_feedback.target_id` can close the loop. See
    `style_bandit`'s module docstring for the full mechanism.

    Returns `(block, applied_keys, style_values)`:
    - `block` — the rendered prompt fragment, identical in shape to
      `render(snap, "chat", ...)`.
    - `applied_keys` — every actionable key (any source, not just style),
      for `meta.prefs_applied` exactly as before this existed.
    - `style_values` — `{key: value}` for the three style dimensions plus
      `teaching.strategy`, actually in force (real preference or sampled
      experiment). Small and new: persisted as `meta.style`, it's the
      ledger `style_bandit` reads back on a later call to score whether
      that value earned its keep.
    """
    prefs = dict(preferences.resolve(snap))
    # `teaching.strategy`'s context is the SUBJECT, not the subspace — see
    # `style_bandit`'s module docstring. `snap.topics` already carries
    # `subspace_id -> subject_id` for every subspace this student has (it's
    # part of the one read pass `build()` already did), so this is a free
    # in-memory lookup, not a second query.
    subject_by_subspace = {t.subspace_id: t.subject_id for t in snap.topics if t.subject_id}
    subject_id = subject_by_subspace.get(subspace_id) if subspace_id else None
    prefs.update(
        await style_bandit.sample(
            user_id,
            prefs,
            subject_id=subject_id,
            subject_by_subspace=subject_by_subspace,
        )
    )

    lines = _chat(snap, prefs, subspace_id)
    block = (
        ""
        if not lines
        else "What you know about this student:\n" + "\n".join(f"- {ln}" for ln in lines)
    )
    applied = sorted(k for k, p in prefs.items() if p.actionable)
    style_values = {
        key: prefs[key].value
        for key in (*style_bandit.ARMS, style_bandit.STRATEGY_KEY)
        if key in prefs and prefs[key].actionable
    }
    return block, applied, style_values


# ── Per-task selections ────────────────────────────────────────────────


def _chat(snap: Snapshot, prefs: dict[str, Preference], subspace_id: str | None) -> list[str]:
    """How to explain, and what this student specifically struggles with here.

    Explicitly NOT included: streaks, badges, other subjects, cold topics. A
    chat turn is about the topic in front of them, and a model told about a
    lapsed subject will find a way to mention it.
    """
    lines = _style(prefs)
    for concept in _local_weak(snap, subspace_id)[:2]:
        lines.append(
            f"Struggles with '{concept.label}' — {concept.accuracy}% correct "
            f"across {concept.asked} quiz questions. Be concrete about it if it "
            f"comes up."
        )
    for concept in snap.falling_concepts[:1]:
        if subspace_id is None or subspace_id in concept.subspace_ids:
            lines.append(
                f"'{concept.label}' is getting worse, not better (down "
                f"{abs(concept.trend or 0)} points)."
            )
    # --- Isolated addition, student-model/quiz pass (task 3) ---------------
    # A minimal line surfacing recurring misconceptions (student_model.py's
    # `MisconceptionView`). Deliberately its own block, not folded into
    # `_style` — this belongs to a different owner's pass and stays easy to
    # spot and revert on its own.
    for m in _local_misconceptions(snap, subspace_id)[:1]:
        lines.append(f"Keeps mixing this up: {m.text}. Address it directly if it comes up.")
    return lines


def _quiz(snap: Snapshot, prefs: dict[str, Preference], subspace_id: str | None) -> list[str]:
    """What to test. Explanation style is irrelevant to a multiple-choice
    question, so none of it is here."""
    lines: list[str] = []
    weak = _local_weak(snap, subspace_id)[:3]
    if weak:
        lines.append(
            "Weakest concepts, worth weighting questions toward: "
            + ", ".join(f"{c.label} ({c.accuracy}%)" for c in weak)
        )
    strong = [c for c in snap.strong_concepts if c.accuracy >= 90][:2]
    if strong:
        lines.append(
            "Already solid, do not spend more than one question on: "
            + ", ".join(c.label for c in strong)
        )
    if goal := prefs.get("study.goal"):
        lines.append(f"Studying for: {goal.value}")
    # --- Isolated addition, student-model/quiz pass (task 3) ---------------
    # Recurring misconceptions are worth testing against directly, on the
    # theory that a quiz question aimed at a known mix-up is more useful than
    # a generic one. Same isolation note as in `_chat` above.
    miscs = _local_misconceptions(snap, subspace_id)[:2]
    if miscs:
        lines.append(
            "Recurring mix-ups worth a question each: " + ", ".join(m.text for m in miscs)
        )
    return lines


def _cards(snap: Snapshot, prefs: dict[str, Preference], subspace_id: str | None) -> list[str]:
    """What to drill. Same logic as quizzes minus the goal, plus the
    retention angle cards uniquely have."""
    lines: list[str] = []
    weak = _local_weak(snap, subspace_id)[:3]
    if weak:
        lines.append(
            "Weakest concepts, worth more cards each: "
            + ", ".join(f"{c.label} ({c.accuracy}%)" for c in weak)
        )
    if goal := prefs.get("study.goal"):
        lines.append(f"Studying for: {goal.value}")
    return lines


def _notes(snap: Snapshot, prefs: dict[str, Preference], subspace_id: str | None) -> list[str]:
    """Structure and depth. A note is read later, so what matters is how it is
    laid out, not the conversational tone."""
    lines = _style(prefs)
    weak = _local_weak(snap, subspace_id)[:2]
    if weak:
        lines.append(
            "Give extra room to the parts covering: "
            + ", ".join(c.label for c in weak)
        )
    return lines


def _brief(snap: Snapshot, prefs: dict[str, Preference], subspace_id: str | None) -> list[str]:
    """The cross-subject picture — the one task that legitimately wants the
    wide view, since its whole job is deciding what to point at next."""
    lines: list[str] = []
    if snap.falling:
        lines.append(
            "Scores dropping in: "
            + ", ".join(
                f"{t.topic} (down {abs(t.trend or 0)})" for t in snap.falling[:2]
            )
        )
    if snap.weak_concepts:
        lines.append(
            "Weakest concepts across everything: "
            + ", ".join(f"{c.label} ({c.accuracy}%)" for c in snap.weak_concepts[:3])
        )
    if snap.cold:
        lines.append(
            "Gone quiet: "
            + ", ".join(
                f"{t.topic} ({t.days_since_activity} days)" for t in snap.cold[:2]
            )
        )
    for habit in snap.observed_habits[:2]:
        lines.append(f"Observed (not something they told you): {habit}")
    return lines


_DISPATCH = {
    "chat": _chat,
    "quiz": _quiz,
    "cards": _cards,
    "notes": _notes,
    "brief": _brief,
}


def applied_keys(snap: Snapshot) -> list[str]:
    """Which preference keys were actually strong enough to change the output.

    Stored on the generated message so `useful` feedback has something to
    confirm. Without it, "this helped" is an unattributable compliment — you
    know the answer landed but not which of five settings made it land, and
    crediting all of them is how a system talks itself into certainty.
    """
    return sorted(k for k, p in preferences.resolve(snap).items() if p.actionable)


# ── Skills ─────────────────────────────────────────────────────────────


def for_skill(skill: dict, snap: Snapshot, *, subspace_id: str | None = None) -> str:
    """Compose a Skill's teaching mode with what we know about this student.

    Skills and the student model previously never met. `_skill_prompt()` built
    one fragment, `rag.build_prompt` appended the student block as a separate
    system part, and the model was handed two paragraphs to reconcile — "be a
    Socratic tutor" over here, "they struggle with Bellman equations" over
    there, with nothing saying the second should shape the first.

    Composing them is the whole point of §9: **the Skill defines the mode, the
    student model parameterises it.** Socratic tutor + weak on Bellman becomes
    Socratic questions aimed at Bellman, rather than Socratic questions about
    whatever the model picks plus a footnote.

    Returned as one fragment so it stays a single instruction. Order matters:
    the skill's own instructions come first and the targeting after, because a
    model reads the last constraint as the most specific.
    """
    parts: list[str] = []
    if instructions := (skill.get("instructions") or "").strip():
        parts.append(instructions)
    if output_format := (skill.get("output_format") or "").strip():
        parts.append(f"Output format: {output_format}")

    targets = [c.label for c in _local_weak(snap, subspace_id)[:2]]
    if targets:
        parts.append(
            "Apply the above specifically to what this student is weakest on: "
            + ", ".join(targets)
            + ". Do not announce that you are doing so."
        )
    return "\n\n".join(parts)


# ── Shared fragments ───────────────────────────────────────────────────

#: One instruction per `style_bandit.STRATEGY_ARMS` value — the whole
#: "teaching strategy" arm rendered as a sentence a model can actually
#: follow, rather than a label it has to interpret.
_STRATEGY_INSTRUCTIONS: dict[str, str] = {
    "example_first": "Open with a concrete example, then generalise to the underlying idea.",
    "analogy_first": "Open with an analogy to something they already know, then map it onto this.",
    "step_by_step": "Derive it step by step; one idea per step.",
    "theory_first": "Start from the definition or principle, then illustrate it.",
    "code_first": "Show working code first, then explain what it does and why.",
    "socratic": "Ask a guiding question first and let them reason toward the answer before you give it.",
}


def _style(prefs: dict[str, Preference]) -> list[str]:
    """Explanation preferences, for the two tasks that produce prose.

    Only actionable preferences are rendered: a low-confidence guess dressed as
    an instruction is worse than silence, because the model will follow it
    exactly as hard as it follows a certainty.
    """
    lines: list[str] = []
    if (note := prefs.get("explanation.note")) and note.actionable:
        lines.append(f"Wants explanations like this, in their words: {note.value}")

    # Learned from feedback. Rendered as instructions rather than observations
    # because unlike a behavioural pattern, these ARE statements about what the
    # student wants — they tapped a button that said so.
    if (length := prefs.get("explanation.length")) and length.actionable:
        lines.append(
            "Keep explanations short and get to the point."
            if length.value == "concise"
            else "Go into detail; they have asked for more than the short version."
        )
    if (depth := prefs.get("explanation.depth")) and depth.actionable:
        lines.append(
            "Pitch it simpler — plain language, less jargon, unpack the terms."
            if depth.value == "simpler"
            else "Pitch it higher; they find the basic version too shallow."
        )
    if (opens := prefs.get("explanation.opens_with")) and opens.actionable:
        lines.append(
            "Open with a concrete example, then generalise."
            if opens.value == "example_first"
            else "Open with the definition or principle, then illustrate it."
        )
    # `teaching.strategy` — currently only ever set by `style_bandit`'s
    # experiment (see `render_chat`), never by `resolve()` itself. One clear
    # instruction per arm; `_STRATEGY_INSTRUCTIONS`'s keys are
    # `style_bandit.STRATEGY_ARMS` by construction (see
    # `test_every_strategy_arm_has_a_rendered_instruction`).
    if (strategy := prefs.get("teaching.strategy")) and strategy.actionable:
        lines.append(_STRATEGY_INSTRUCTIONS[strategy.value])
    # Only the `direct` side produces an instruction: "hints first" is already
    # the default posture, so restating it would spend a line to change nothing.
    answer = prefs.get("interaction.answer_mode")
    if answer and answer.actionable and answer.value == "direct":
        lines.append("Answer directly first. Do not lead with questions.")

    if (mode := prefs.get("interaction.mode")) and mode.actionable:
        # Hedged on purpose. This is an observation about behaviour, not a
        # statement about what teaches them best — the two come apart, and
        # Phase 3's experiments exist to find out where.
        phrasing = {
            "discussion": "tends to learn by asking questions rather than testing themselves",
            "drilling": "tends to learn by drilling flashcards",
            "testing": "tends to learn by testing themselves",
        }[mode.value]
        lines.append(f"Observed: {phrasing} ({mode.because}).")
    return lines


def _local_weak(snap: Snapshot, subspace_id: str | None):
    """Weak concepts, scoped to the topic in play when there is one.

    Falling back to the global list matters: agents launched from a topic with
    no quiz history yet would otherwise get nothing, when the student's wider
    record is perfectly relevant to what to emphasise.
    """
    if subspace_id:
        local = [c for c in snap.concepts_in(subspace_id) if c.is_weak]
        if local:
            return local
    return snap.weak_concepts


# --- Isolated addition, student-model/quiz pass (task 3) -------------------
def _local_misconceptions(snap: Snapshot, subspace_id: str | None):
    """Recurring misconceptions (`student_model.MisconceptionView`), scoped
    to the topic in play when it has any of its own — same fallback shape as
    `_local_weak`. Reads only `snap.topics[i].misconceptions` /
    `snap.top_misconceptions`, both computed in `student_model.snapshot()`;
    nothing here touches `_style` or the style-bandit machinery above."""
    if subspace_id:
        local = next(
            (t.misconceptions for t in snap.topics if t.subspace_id == subspace_id), ()
        )
        if local:
            return local
    return snap.top_misconceptions
