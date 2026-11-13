"""What the student is studying FOR — and what that changes about teaching.

"Explain B-trees" is a different job the night before a university paper, in
the week before GATE, and the day before an interview. The same material, but:
what to stress, how long to talk, what to ask back. The student says which one
they are in (Settings › Learning) and can change it whenever their situation
does; every task that writes for them reads it from here.

A closed set on purpose, like `preferences.KEYS`: a free-text "mode" would be
a prompt-injection surface and nothing here needs it — the free-text goal
("Backend role at a fintech", "GATE CSE 2027") already rides beside it.

Each instruction is one or two sentences. They cost a few dozen tokens on a
request, which is the whole price of this feature on the free tier.
"""

from __future__ import annotations

from typing import Literal

Mode = Literal["college", "competitive", "interview", "curious"]

MODES: dict[str, tuple[str, str]] = {
    "college": (
        "College exam",
        "They are preparing for a university exam. Stress definitions they can write down, derivations "
        "and worked steps, and the points that earn marks in a long answer. Flag what is likely to be asked.",
    ),
    "competitive": (
        "Competitive exam",
        "They are preparing for a competitive exam such as GATE. Stress speed and accuracy: the shortest "
        "correct method, standard shortcuts, formulas to have ready, and the traps that cost marks in "
        "multiple-choice and numerical questions. If they ask for practice, give ONE question at a time "
        "from their material, wait, then give the solution path and the common wrong turn.",
    ),
    "interview": (
        "Interview prep",
        "They are preparing for a job interview. Give the answer as they would say it aloud, in about thirty "
        "seconds, first; then the depth behind it, the trade-offs, and one follow-up an interviewer would "
        "likely ask. Prefer clear reasoning over exhaustive detail. If they ask to be interviewed or mocked, "
        "play the interviewer: ask ONE question at a time, drawn from their own material, and wait. After "
        "each answer of theirs, say what was strong, what was missing or wrong, then ask the next question.",
    ),
    "curious": (
        "Learning it properly",
        "They are learning this for understanding, not for a test. Build intuition first: why it works, what "
        "problem it solves, a real example. Do not drill them or steer to exam points.",
    ),
}


def label(mode: str | None) -> str:
    return MODES[mode][0] if mode in MODES else ""


def instruction(mode: str | None) -> str:
    return MODES[mode][1] if mode in MODES else ""
