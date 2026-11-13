"""Why an answer sounds the way it does — said to the student, in their terms.

The tutor already reads every term in the subject's sense, aims at the concepts
a student keeps missing and takes on the explanation style they have shown they
like. None of that was visible: an answer from this app looked like an answer
from any chatbot. This turns what was ALREADY decided for the turn into a few
short, true phrases shown under the reply, so the difference is something a
student can read, and so "why did it say it like that?" has an answer they can
check (and change, with the feedback chips).

No model call and no new data: every phrase is rendered from values the chat
route computed to build the prompt. If a fact was not used for this answer, it
is not claimed here.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from . import study_mode
from .chat_context import TopicContext

MAX_LINES = 3
_CAP = 70

#: Short fragments, joined into ONE "Your style" phrase. Five separate chips for
#: five style settings read as noise; one sentence reads as a decision.
_STYLE_FRAGMENTS: dict[tuple[str, str], str] = {
    ("explanation.length", "concise"): "kept short",
    ("explanation.length", "detailed"): "in detail",
    ("explanation.depth", "simpler"): "plain words",
    ("explanation.depth", "deeper"): "pitched higher",
    ("explanation.opens_with", "example_first"): "example first",
    ("explanation.opens_with", "theory_first"): "idea first",
    ("interaction.answer_mode", "direct"): "straight to the point",
    ("teaching.strategy", "example_first"): "example first",
    ("teaching.strategy", "analogy_first"): "by analogy",
    ("teaching.strategy", "step_by_step"): "step by step",
    ("teaching.strategy", "theory_first"): "idea first",
    ("teaching.strategy", "code_first"): "code first",
    ("teaching.strategy", "socratic"): "with questions",
}


def _short(text: str, cap: int = _CAP) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= cap else text[: cap - 1].rstrip() + "…"


def explain(
    *,
    ctx: TopicContext,
    style: Mapping[str, str],
    weak: Sequence[tuple[str, int]] = (),
    sources: Sequence[str] = (),
    scope: str = "",
) -> list[str]:
    """At most three short phrases for what shaped this answer.

    First the guardrail (where it was allowed to come from), then the one or two
    most personal things: a weak spot it aimed at, what they are preparing for,
    one summary of their explanation style. Which files it cited is already on
    the answer's Sources row, and the subject sense is plumbing, so neither is
    repeated here. `style` is `{preference key: value}` actually in force;
    `weak` is `(concept, accuracy %)` the prompt told the model to be concrete
    about.
    """
    lines: list[str] = []
    if scope == "files":
        lines.append("Kept to your files")
    elif scope == "subject" and not sources:
        # Nothing of theirs backed this answer: say so, so it is never mistaken for their material.
        lines.append("General knowledge, not from your files")
    elif scope == "subject":
        lines.append("Your files first, then general knowledge")

    personal: list[str] = []
    for label, accuracy in weak[:1]:
        personal.append(f"Aimed at {_short(label, 32)} ({accuracy}% so far)")
    if ctx.mode:
        personal.append(f"Tuned for {study_mode.label(ctx.mode).lower()}")
    fragments: list[str] = []
    for key, value in style.items():
        frag = _STYLE_FRAGMENTS.get((key, value))
        if frag and frag not in fragments:
            fragments.append(frag)
    if fragments:
        personal.append("Your style: " + ", ".join(fragments[:3]))
    if ctx.goal:
        personal.append(f"For {_short(ctx.goal, 40)}")

    lines.extend(personal[: MAX_LINES - len(lines)])
    return lines[:MAX_LINES]
