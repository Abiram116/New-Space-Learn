"""Recent chat history, shared by chat itself and every generation agent.

Agents launched from chat (cards/quiz/notes) should already know what was
just discussed rather than asking the frontend to summarize it — this is
the one place that fetch lives so it isn't reimplemented per-router.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from . import study_mode, supabase


async def recent_history(
    user_id: str, subspace_id: str, *, limit: int = 8
) -> list[dict[str, str]]:
    rows = await supabase.db_select(
        "chat_messages",
        filters={"user_id": f"eq.{user_id}", "subspace_id": f"eq.{subspace_id}"},
        order="created_at.desc",
        limit=limit,
    )
    rows.reverse()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def format_history(history: list[dict[str, str]]) -> str:
    if not history:
        return ""
    lines = [f"{h['role']}: {h['content']}" for h in history]
    return "\n".join(lines)


# ── Where a chat turn is happening ─────────────────────────────────────
#
# A topic called "transformer" means the neural network to a student whose
# subject is deep learning, and a coil of wire to one whose subject is
# electrical machines. The model only knows which if it is told, so every chat
# turn carries this: the subject, the topic, the linked topics and what the
# student is studying for. Built from rows the request already has (the
# subspace row with its subject's name, and the student-model snapshot), so it
# costs no extra query, and kept to a few lines, so it costs few tokens.

#: Longest name or goal put into a prompt. They are the student's own text.
_NAME_CHARS = 80
_GOAL_CHARS = 140
#: Topic names too generic to tell one topic from another in a question.
_GENERIC_NAMES = frozenset(
    "untitled notes general misc miscellaneous basics introduction intro overview revision "
    "chapter unit module lecture lectures exam exams practice questions doubts topic test".split()
)
_WORDS = re.compile(r"[a-z0-9+#]+")


def _clean(text: object, cap: int) -> str:
    """One line of the student's own text, safe to quote in a prompt."""
    s = " ".join(str(text or "").split())
    s = s.replace('"', "'").replace("`", "'").replace("<", "(").replace(">", ")")
    return s if len(s) <= cap else s[: cap - 1].rstrip() + "…"


def _norm_words(text: str) -> tuple[str, ...]:
    return tuple(_WORDS.findall(text.lower()))


@dataclass(frozen=True, slots=True)
class TopicContext:
    """The subject, topic and goal a chat turn is about."""

    topic: str
    subject: str = ""
    #: Names of the topics linked to this one: their files are searched too.
    linked: tuple[str, ...] = ()
    #: What the student is preparing for, in their words ("GATE 2027").
    goal: str = ""
    #: The student's other topics, NOT linked here, as (topic, subject).
    others: tuple[tuple[str, str], ...] = ()
    #: Files ready to search across this topic and its linked ones; None if unknown.
    files: int | None = None
    #: What they are studying for ("college", "competitive", "interview", "curious"), or "".
    mode: str = ""
    #: The OTHER subjects this student studies, e.g. ("Deep Learning", "NLP"). Says which
    #: field they are in when a word is ambiguous ("transformer": the model, the device,
    #: or the film). Not part of `key()`: adding a subject should not discard cached answers.
    studies: tuple[str, ...] = ()

    @property
    def label(self) -> str:
        """"Deep Learning › Transformer" — how the topic is named to a model."""
        return f"{self.subject} › {self.topic}" if self.subject else self.topic

    @property
    def sense(self) -> str:
        """Whose meaning a word takes: the subject's, else the topic's."""
        return self.subject or self.topic

    def key(self) -> dict[str, object]:
        """Everything here that changes an answer, for the answer cache."""
        return {"subject": self.subject, "topic": self.topic, "linked": sorted(self.linked), "goal": self.goal, "mode": self.mode}

    def mentions(self, question: str) -> list[tuple[str, str]]:
        """Other topics of this student's that the question names outright.

        A name counts only as whole words, only when it is not generic, and only
        when it is not already part of this topic's own context: a question about
        "transformer" in Deep Learning › Transformer is about this topic, even if
        the student also has a "Transformer" topic under Electrical Machines."""
        asked = f" {' '.join(_norm_words(question))} "
        own = set(_norm_words(" ".join((self.topic, self.subject, *self.linked))))
        found: list[tuple[str, str]] = []
        for name, subject in self.others:
            words = _norm_words(name)
            if not words or set(words) <= own or set(words) <= _GENERIC_NAMES:
                continue
            if len("".join(words)) < 3:
                continue
            if f" {' '.join(words)} " in asked and (name, subject) not in found:
                found.append((name, subject))
        return found[:2]


def _days_until(day: object) -> int | None:
    """Whole days from the student's today to an ISO date; None if not one."""
    from datetime import date

    from . import clock

    try:
        return (date.fromisoformat(str(day)) - clock.today()).days
    except ValueError:
        return None


def topic_context(
    subspace: dict,
    *,
    topics: list | tuple = (),
    linked_ids: list[str] | tuple[str, ...] = (),
    settings: dict | None = None,
) -> TopicContext:
    """Build the context from the subspace row (`guards.assert_subspace`, which
    embeds the subject's name) and the student-model snapshot's `topics`
    (anything with subspace_id / topic / subject / docs) and `settings`."""
    subspace_id = subspace.get("id")
    topic = _clean(subspace.get("name") or "this topic", _NAME_CHARS)
    subject = _clean((subspace.get("subjects") or {}).get("name") or "", _NAME_CHARS)
    by_id = {getattr(t, "subspace_id", None): t for t in topics}
    if not subject and subspace_id in by_id:
        subject = _clean(getattr(by_id[subspace_id], "subject", ""), _NAME_CHARS)
    linked = tuple(_clean(by_id[i].topic, _NAME_CHARS) for i in linked_ids if i in by_id)
    skip = {subspace_id, *linked_ids}
    others = tuple(
        (_clean(t.topic, _NAME_CHARS), _clean(getattr(t, "subject", ""), _NAME_CHARS))
        for t in topics
        if getattr(t, "subspace_id", None) not in skip
    )[:200]
    files: int | None = None
    if subspace_id in by_id:
        files = sum(int(getattr(by_id[i], "docs", 0) or 0) for i in (subspace_id, *linked_ids) if i in by_id)
    explicit = dict((settings or {}).get("student_model") or {})
    goal = _clean(explicit.get("exam_context") or "", _GOAL_CHARS)
    # "GATE 2027" alone reads the same on day 300 and day 3. With the date the
    # tutor can pitch to the time left: breadth early, what is likely to be
    # asked as it nears.
    if goal and (when := _days_until(explicit.get("exam_date"))) is not None and 0 <= when <= 400:
        goal += " (today)" if when == 0 else f" (in {when} day{'s' if when != 1 else ''})"
    mode = explicit.get("study_mode") if explicit.get("study_mode") in study_mode.MODES else ""
    # Distinct subject names across everything else they study, in the order they
    # appear: the cheapest honest signal of which field "transformer" belongs to.
    studies: list[str] = []
    for _topic, other_subject in others:
        if other_subject and other_subject != subject and other_subject not in studies:
            studies.append(other_subject)
        if len(studies) == 4:
            break
    return TopicContext(
        topic=topic, subject=subject, linked=linked, goal=goal, others=others, files=files, mode=mode, studies=tuple(studies)
    )


def describe(ctx: TopicContext) -> str:
    """The prompt's opening context: a few lines, every turn."""
    lines = [f'You are this student\'s tutor for the topic "{ctx.topic}"' + (f' in their subject "{ctx.subject}".' if ctx.subject else ".")]
    if ctx.linked:
        lines.append("Linked topics, also in scope: " + ", ".join(f'"{n}"' for n in ctx.linked) + ".")
    if ctx.goal:
        lines.append(f'They are preparing for: "{ctx.goal}". Pitch depth, terms and examples to that.')
    if ctx.studies:
        lines.append(
            "They also study: " + ", ".join(f'"{n}"' for n in ctx.studies) + ". When a word has more than one meaning, "
            "take the one these fields use (\"transformer\" is the neural network for a machine-learning student, the "
            "electrical device for an electrical-engineering student) and never the film or the toy."
        )
    if ctx.mode:
        lines.append(study_mode.instruction(ctx.mode))
    lines.append(
        f'Read every term in the sense it has in "{ctx.label}": a word with several meanings means the one '
        "this subject uses, never another field's. Don't ask which meaning unless the subject itself leaves it open."
    )
    return " ".join(lines)


def mention_note(found: list[tuple[str, str]], ctx: TopicContext) -> str:
    """Said only when the question names another of the student's topics."""
    if not found:
        return ""
    names = ", ".join(f'"{t}"' + (f' (in "{s}")' if s and s != ctx.subject else "") for t, s in found)
    return (
        f"The question names {names}: another of the student's own topics, not linked to this one, so its "
        "files are not searched here. If the question is mainly about that topic, say in one sentence that "
        f'they can ask it there, or link it to "{ctx.topic}" so its files are searched here. Answer here only '
        "what relates to this topic or its subject."
    )
