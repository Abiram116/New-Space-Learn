"""Writing a quiz: plan, write, check, verify, repair.

A quiz used to be one prompt and whatever came back. Nothing checked that a
question's answer was actually in the material, that two questions weren't the
same question, or that the last quiz hadn't asked it already. Now:

    plan     which material to write from (`coverage.py`, code, no model call)
    write    one call: a couple more questions than asked for, each naming
             the numbered source it was written from
    check    in code: well formed, a real source, not a repeat
             (`question_checks.py`)
    verify   one call to the small model, for the whole quiz at once: is each
             answer supported by its source, and is it the only right choice?
    repair   only if too few survived, and only if there is time: one more
             call for the shortfall, checked in code

So a quiz costs two model calls, and three at worst. Any step after "write"
that fails — a timeout, a rate limit, a reply that isn't JSON — is skipped
rather than allowed to fail the quiz; questions that were not verified say so
(`QuizQuestion.checked`).
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import random
import re
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field

from ..config import settings
from ..errors import NotFound, NothingIndexed
from ..schemas import QuizQuestion, QuizVariantQuestion
from . import coverage, question_checks, supabase, usage
from .coverage import Source
from .embeddings import embed_texts
from .llm import extract_title_line, get_llm, loads_lenient
from .quiz_shuffle import shuffle_with_order
from .voice import QUIZ_AGENT_VOICE

log = logging.getLogger("space_learn.quiz_agent")

#: Questions written beyond those asked for, so failures can be dropped
#: without a repair call.
SPARE = 2
#: The most questions asked of one call. A question with all its fields is
#: ~235 tokens, and a reply is capped at `groq_max_completion_tokens` (4,096);
#: a bigger quiz gets the rest from the repair call.
WRITE_MAX = 15
#: A repair call is only made this early: the browser gives up on a request
#: at 35 seconds, and a repair is a full call to the large model.
REPAIR_BEFORE_S = 16.0
VERIFY_TIMEOUT_S = 12.0
#: Earlier questions shown to the writer as "don't ask these again".
SHOW_EARLIER = 12

#: (messages, model, temperature) -> reply; `json_object=True` when the reply
#: must be a JSON object (see `llm.stream_chat`).
Complete = Callable[..., Awaitable[str]]


@dataclass(slots=True)
class Draft:
    questions: list[QuizQuestion]
    title: str | None = None
    #: What happened at each step, for the log.
    trace: dict = field(default_factory=dict)


async def _complete(messages: list[dict], model: str, temperature: float, *, json_object: bool = False) -> str:
    parts: list[str] = []
    # Only passed when asked for, so a plain call looks exactly as it always did.
    extra = {"json_object": True} if json_object else {}
    async for delta in get_llm().stream_chat(messages, model=model, temperature=temperature, **extra):
        parts.append(delta)
    return "".join(parts).strip()


def material(sources: Sequence[Source], conversation: str) -> list[Source]:
    """The numbered material: the planned chunks, then the recent conversation
    (a student's own explanations count as their material too)."""
    out = list(sources)
    if conversation.strip():
        out.append(Source(len(out) + 1, "", "Your recent conversation", "", conversation.strip()))
    return out


def _sources_block(items: Sequence[Source]) -> str:
    return "\n\n".join(f"[{s.number}] ({s.label})\n{s.content}" for s in items)


#: What the student sees as a question's source when it was written from the
#: model's own knowledge — said on every question, never implied.
GENERAL_LABEL = "General knowledge — not from your material"


def write_prompt(
    *,
    count: int,
    topic: str | None,
    label: str,
    mix: dict[str, int],
    items: Sequence[Source],
    earlier: Sequence[dict],
    general: bool = False,
) -> str:
    avoid = [str(q.get("q", "")).strip()[:140] for q in earlier[:SHOW_EARLIER] if q.get("q")]
    avoid_block = (
        "Questions this student has already been asked on this topic — do not ask any of them again, "
        "even reworded:\n" + "\n".join(f"- {q}" for q in avoid) + "\n\n"
        if avoid
        else ""
    )
    grounding = (
        # Asked for by the student, by name: there is no material to cite.
        "There is no source material for this quiz: write from well-established, textbook-level knowledge "
        "of the subject only — nothing contested, recent or obscure.\n\n"
        if general
        else "Write every question from ONE of the numbered sources below and from nothing else: "
        "the fact its correct answer depends on must be stated in that source. "
        "Spread the questions across the sources rather than writing several from one. "
        "Keep any math in the notation the source uses.\n\n"
        f"Sources:\n{_sources_block(items)}\n\n"
    )
    source_field = '"source": 0, ' if general else '"source": int, '
    return (
        f"Write {count} multiple-choice questions about "
        f"'{topic or 'the key concepts in this material'}', within the subject '{label}' — "
        "resolve any ambiguity in the topic name using that subject, not a generic reading of the words. "
        f"{grounding}"
        f"{avoid_block}"
        "Return a JSON array; each item has fields: "
        '{"q": str, "choices": [str, str, str, str], "answer_index": 0-3, '
        + source_field
        + '"subtopic": str, "explanation": str, "difficulty": str, "kind": str, '
        '"misconceptions": [str|null, ...], "prerequisites": [str, ...]}. '
        + ("" if general else "source is the NUMBER of the source the question was written from. ")
        + "subtopic is the specific concept this question tests, narrower than the overall topic "
        "(e.g. 'Policy Iteration', not 'Reinforcement Learning'). "
        "explanation is 1-2 sentences saying WHY the correct answer is correct and, where there is an "
        "obvious trap, why the most tempting wrong choice is wrong. Write it to the student, in second person. "
        f'difficulty is "easy", "medium" or "hard". Write about {mix["easy"]} easy, {mix["medium"]} medium and '
        f'{mix["hard"]} hard questions — this mix targets roughly a 75% success rate for this student on this '
        'topic right now. kind is "recall" (asks for a fact or definition) or "apply" (asks the student to use '
        "it, e.g. on a new example). misconceptions is one entry per choice, same order as choices: for each "
        "WRONG choice, a short phrase (5 words or fewer) naming the misconception it represents — null for the "
        "correct choice. prerequisites is 0-2 short concept names (2-4 words each) this question depends on. "
        "Exactly one choice may be correct. "
        "Before the array, on its own line, write a title for this quiz: 'TITLE: ' followed by 3-6 words naming "
        "what it actually covers (e.g. 'TITLE: Policy Iteration Basics'), not a generic label. "
        "Then the JSON array — no other prose, no code fences."
    )


def verify_prompt(items: Sequence[Source], questions: Sequence[dict], *, general: bool = False) -> str:
    lines = []
    for n, q in enumerate(questions, start=1):
        choices = "\n".join(f"  {'ABCD'[i]}) {c}" for i, c in enumerate(q["choices"]))
        where = "" if general else f" (source {q.get('source')})"
        lines.append(f"Q{n}{where}: {q['q']}\n{choices}\n  Marked answer: {'ABCD'[q['answer_index']]}")
    if general:
        # No material to check against: the check is the textbook itself.
        return (
            "You check quiz questions written from general knowledge. For each question:\n"
            '- "supported": true only if the fact the marked answer depends on is well-established textbook knowledge.\n'
            '- "correct": true only if the marked answer is right AND no other choice is also right.\n'
            "Reply with a JSON object only, one verdict per question: "
            '{"verdicts": [{"n": 1, "supported": true, "correct": true}]}.\n\n'
            "Questions:\n" + "\n\n".join(lines)
        )
    return (
        "You check quiz questions against the material they were written from. For each question:\n"
        '- "supported": true only if its own source states the fact the marked answer depends on.\n'
        '- "correct": true only if the marked answer is right according to that source AND no other choice is also right.\n'
        'Reply with a JSON object only, one verdict per question: '
        '{"verdicts": [{"n": 1, "supported": true, "correct": true}]}.\n\n'
        f"Material:\n{_sources_block(items)}\n\nQuestions:\n" + "\n\n".join(lines)
    )


def parse_items(raw: str) -> list[dict]:
    """The JSON array in a model reply, tolerating text around it. Empty when there is none."""
    start, end = raw.find("["), raw.rfind("]")
    if start == -1 or end <= start:
        return []
    try:
        data = loads_lenient(raw[start : end + 1])
    except (json.JSONDecodeError, ValueError):
        return []
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


def parse_verdicts(raw: str) -> list[dict]:
    """The verifier's verdicts: `{"verdicts": [...]}`, or a bare array."""
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end > start:
        try:
            data = loads_lenient(raw[start : end + 1])
        except (json.JSONDecodeError, ValueError):
            data = None
        if isinstance(data, dict) and isinstance(data.get("verdicts"), list):
            return [v for v in data["verdicts"] if isinstance(v, dict)]
    return parse_items(raw)


def failed_checks(verdicts: list[dict], count: int) -> set[int] | None:
    """0-based indexes the verifier failed. None when its reply was unusable;
    a question it did not mention is not failed — the verifier's omission is
    not evidence against the question."""
    if not verdicts:
        return None
    failed: set[int] = set()
    for v in verdicts:
        n = v.get("n")
        if isinstance(n, int) and 1 <= n <= count and (v.get("supported") is False or v.get("correct") is False):
            failed.add(n - 1)
    return failed


def _usable(items: list[dict], sources: int, earlier: Sequence[dict]) -> tuple[list[dict], dict]:
    """The items that pass every check code can make, and how many failed which."""
    well_formed = [it for it in items if not question_checks.problems(it, sources=sources)]
    repeats = question_checks.repeats_by_wording(well_formed, earlier)
    kept = [it for i, it in enumerate(well_formed) if i not in repeats]
    return kept, {"malformed": len(items) - len(well_formed), "repeats": len(repeats)}


async def write_quiz(
    *,
    count: int,
    topic: str | None,
    label: str,
    mix: dict[str, int],
    sources: Sequence[Source],
    conversation: str,
    earlier: Sequence[dict],
    student_context: str = "",
    general: bool = False,
    complete: Complete = _complete,
    embed: question_checks.Embed = embed_texts,
    clock: Callable[[], float] = time.monotonic,
) -> Draft:
    """`general`: the student asked for questions from the model's own
    knowledge (`MaterialSource "general"`); there are no sources, and every
    question says so."""
    started = clock()
    items_ = [] if general else material(sources, conversation)
    system = QUIZ_AGENT_VOICE + (f"\n\n{student_context}" if student_context else "")

    def ask(n: int, already: Sequence[dict]) -> list[dict]:
        prompt = write_prompt(count=n, topic=topic, label=label, mix=mix, items=items_, earlier=already, general=general)
        return [{"role": "system", "content": system}, {"role": "user", "content": prompt}]

    # write
    with usage.task("quiz.write"):
        raw = await complete(ask(min(count + SPARE, WRITE_MAX), earlier), settings.groq_model, 0.3)
    title = extract_title_line(raw)
    kept, trace = _usable(parse_items(raw), len(items_), earlier)
    trace["written"] = len(parse_items(raw))
    meaning = await _safely(question_checks.repeats_by_meaning(kept, earlier, embed), set())
    kept = [it for i, it in enumerate(kept) if i not in meaning]
    trace["repeats"] += len(meaning)

    # verify
    verified = False
    if kept:
        with usage.task("quiz.verify"):
            reply = await _safely(
                asyncio.wait_for(
                    complete(
                        [{"role": "user", "content": verify_prompt(items_, kept, general=general)}],
                        settings.groq_model_fast,
                        0.0,
                        json_object=True,
                    ),
                    VERIFY_TIMEOUT_S,
                ),
                "",
            )
        failed = failed_checks(parse_verdicts(reply), len(kept))
        if failed is not None:
            verified = True
            trace["unsupported"] = len(failed)
            kept = [it for i, it in enumerate(kept) if i not in failed]
    trace["verified"] = verified
    for it in kept:
        it["_checked"] = verified

    # repair
    short = count - len(kept)
    trace["repaired"] = 0
    if short > 0 and clock() - started < REPAIR_BEFORE_S:
        with usage.task("quiz.repair"):
            raw = await _safely(complete(ask(short, [*kept, *earlier]), settings.groq_model, 0.3), "")
        extra, _ = _usable(parse_items(raw), len(items_), [*kept, *earlier])
        for it in extra[:short]:
            it["_checked"] = False
        kept += extra[:short]
        trace["repaired"] = len(extra[:short])

    questions = [_to_question(it, items_, general=general) for it in kept[:count]]
    trace["kept"] = len(questions)
    trace["seconds"] = round(clock() - started, 1)
    return Draft([q for q in questions if q is not None], title, trace)


def _to_question(item: dict, items: Sequence[Source], *, general: bool = False) -> QuizQuestion | None:
    source = items[item["source"] - 1] if isinstance(item.get("source"), int) and 0 < item["source"] <= len(items) else None
    data = {k: v for k, v in item.items() if k not in ("source", "source_chunk", "checked", "_checked")}
    try:
        return QuizQuestion(
            **data,
            source=GENERAL_LABEL if general else (source.label if source else None),
            source_chunk=(source.chunk_id or None) if source else None,
            checked=item.get("_checked"),
        )
    except Exception:
        return None


async def _safely(awaitable: Awaitable, fallback):  # noqa: ANN001, ANN202
    """An optional step's result, or `fallback` if it failed in any way."""
    try:
        return await awaitable
    except Exception as e:  # noqa: BLE001 — every later step is optional by design
        log.info("quiz step skipped: %s", re.sub(r"\s+", " ", str(e))[:120])
        return fallback


# ── Material: what a quiz or deck is written from ──────────────────────
#
# The student picks (`schemas.MaterialSource`). Each choice either finds
# something to write from or says, in words, what to add — the model is never
# left to fill an empty source from its own knowledge unless that is what the
# student picked ("general"), and then every question says so.

#: Notes read for "every note in this topic". Newest first.
NOTES_READ = 20
#: One piece of a note handed to the model, at most.
NOTE_PIECE_CHARS = 1100
#: A note shorter than this (once images and markup are gone) has nothing to
#: write a question from.
NOTE_MIN_CHARS = 40

_IMAGE_MD = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_DATA_URI = re.compile(r"data:[a-z]+/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+", re.IGNORECASE)
_TAG = re.compile(r"</?[a-zA-Z][^>\n]{0,200}>")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$")


@dataclass(slots=True)
class Material:
    sources: list[Source]
    conversation: str = ""
    #: The student asked for the model's own knowledge; there are no sources.
    general: bool = False
    #: How the student would name what this was written from, for the log.
    kind: str = "files"


def clean_note(body_md: str) -> str:
    """A note as text a model can write from: images (often megabytes of
    base64), stray HTML and entities gone; math and code kept as written."""
    text = _DATA_URI.sub("", body_md or "")
    text = _IMAGE_MD.sub("", text)
    text = _TAG.sub("", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _note_pieces(body: str) -> list[tuple[str, str]]:
    """(heading, text) pieces of one note, each at most NOTE_PIECE_CHARS,
    split at blank lines so a formula or a list stays whole where it can."""
    pieces: list[tuple[str, str]] = []
    heading, buf = "", ""

    def flush() -> None:
        nonlocal buf
        if buf.strip():
            pieces.append((heading, buf.strip()))
        buf = ""

    for para in re.split(r"\n\s*\n", body):
        first = para.strip().splitlines()[0] if para.strip() else ""
        if (m := _HEADING.match(first)) and len(para.strip().splitlines()) == 1:
            flush()
            heading = m.group(1).strip()[:80]
            continue
        while len(para) > NOTE_PIECE_CHARS:
            # One paragraph longer than a piece: cut at the last sentence end
            # that fits, or hard at the limit when there is none.
            cut = para.rfind(". ", 0, NOTE_PIECE_CHARS)
            cut = cut + 1 if cut > NOTE_PIECE_CHARS // 3 else NOTE_PIECE_CHARS
            flush()
            buf = para[:cut]
            flush()
            para = para[cut:].lstrip()
        if len(buf) + len(para) + 2 > NOTE_PIECE_CHARS:
            flush()
        buf = f"{buf}\n\n{para}" if buf else para
    flush()
    return pieces


def note_sources(notes: Sequence[dict], *, focus: str | None = None) -> list[Source]:
    """Numbered sources from the student's notes, within the same size budget
    as a topic's documents (`coverage.BUDGET_CHARS`).

    A long note is not read from the top: with a focus, the pieces that share
    the most words with it; without one, pieces spread evenly across every
    note, the notes taking turns — the same idea as `coverage.spread`.
    """
    per_note: list[list[tuple[str, str, str]]] = []
    for n in notes:
        title = str(n.get("title") or "Untitled note").strip()[:80]
        body = clean_note(str(n.get("body_md") or ""))
        if len(body) >= NOTE_MIN_CHARS:
            per_note.append([(title, h, t) for h, t in _note_pieces(body)])
    # Notes take turns, so "all notes" is not just the newest one.
    pool: list[tuple[str, str, str]] = []
    for i in range(max((len(p) for p in per_note), default=0)):
        pool += [p[i] for p in per_note if i < len(p)]
    if not pool:
        return []
    k = coverage.MAX_SOURCES
    if focus and focus.strip():
        want = question_checks.words(focus)
        ranked = sorted(range(len(pool)), key=lambda i: -len(want & question_checks.words(pool[i][1] + " " + pool[i][2])))
        # Most relevant first, so the size budget cuts the least relevant.
        chosen = ranked[:k]
    elif len(pool) > k:
        chosen = sorted({round(i * (len(pool) - 1) / (k - 1)) for i in range(k)})
    else:
        chosen = list(range(len(pool)))
    kept: list[int] = []
    used = 0
    for i in chosen:
        size = min(len(pool[i][2]), coverage.BUDGET_CHARS)
        if kept and used + size > coverage.BUDGET_CHARS:
            break
        kept.append(i)
        used += size
    # Numbered in reading order, whichever way they were picked.
    return [
        Source(n, "", f"Note: {pool[i][0]}", pool[i][1], pool[i][2][: coverage.BUDGET_CHARS])
        for n, i in enumerate(sorted(kept), start=1)
    ]


def _chat_tail(conversation: str) -> str:
    """The most recent part of a conversation, inside the size budget."""
    text = conversation.strip()
    return text if len(text) <= coverage.BUDGET_CHARS else "…" + text[-coverage.BUDGET_CHARS :]


async def gather_material(
    *,
    user_id: str,
    subspace_id: str,
    source: str | None,
    note_id: str | None,
    topic: str | None,
    count: int,
    used,  # noqa: ANN001 - Counter[str], from a ledger
    weak_concepts: Sequence[str],
    linked_ids: Sequence[str],
    conversation: str,
) -> Material:
    """What to write from, by the student's choice. Raises `NothingIndexed`
    (with what to add) when the choice has nothing in it, and `NotFound` for
    a note that is gone. `source=None` is the original behaviour: the
    topic's files with the recent chat, either one enough."""

    async def files() -> list[Source]:
        return await coverage.plan(
            subspace_id=subspace_id,
            linked_subspace_ids=linked_ids,
            topic=topic,
            questions=count,
            used=used,
            weak_concepts=weak_concepts,
        )

    if source is None:
        found = await files()
        if not found and not conversation.strip():
            raise NothingIndexed()
        return Material(found, conversation, kind="files+chat")

    if source == "files":
        found = await files()
        if not found:
            raise NothingIndexed(
                "This topic has no files ready yet (one still being read counts as not ready). "
                "Add a file in Docs, or make it from your notes or the chat instead."
            )
        return Material(found, kind="files")

    if source == "chat":
        if not conversation.strip():
            raise NothingIndexed(
                "There's no chat in this topic yet. Ask something in the chat first, "
                "or make it from your files or notes instead."
            )
        return Material([], _chat_tail(conversation), kind="chat")

    if source == "notes":
        if note_id:
            rows = await supabase.db_select(
                "notes",
                filters={"user_id": f"eq.{user_id}", "id": f"eq.{note_id}"},
                select="id,title,body_md",
                limit=1,
            )
            if not rows:
                raise NotFound("That note isn't there any more — it may have been deleted.")
            found = note_sources(rows, focus=topic)
            if not found:
                raise NothingIndexed(
                    "That note is empty, or too short to write from. Add to it first, or pick another source."
                )
            return Material(found, kind="note")
        rows = await supabase.db_select(
            "notes",
            filters={"user_id": f"eq.{user_id}", "subspace_id": f"eq.{subspace_id}"},
            select="id,title,body_md",
            order="updated_at.desc",
            limit=NOTES_READ,
        )
        found = note_sources(rows, focus=topic)
        if not found:
            raise NothingIndexed(
                "This topic has no notes with anything in them yet. Write a note, "
                "or make it from your files or the chat instead."
            )
        return Material(found, kind="notes")

    if source == "general":
        return Material([], general=True, kind="general")

    raise NothingIndexed("Pick what to make it from: your files, your notes, or the chat.")


# ── Rewording a quiz for a retake ──────────────────────────────────────
#
# Same concepts, same right answers, new wording and order, so a retake tests
# the idea rather than memory of the sentence. One call to the small model;
# nothing stored. The model rewrites each choice IN PLACE and never says
# which is right — the code keeps the answer by position, checks each
# rewording (`question_checks.reword_problems`), and reshuffles afterwards.
#
# Why no second model call to check it, as a new quiz gets: a new question can
# be wrong in ways only reading the source shows; a rewording can only be
# wrong by saying something different, and what changes an answer — numbers,
# formulas, a "not" or "except", a choice drifting into another's meaning —
# code can see. A question that fails keeps its stored wording, which was
# already checked, so the worst case is a question that is merely reshuffled.
# That keeps a reworded retake at one call on the free tier.

REWORD_TIMEOUT_S = 20.0
#: Questions reworded in one call, at most: a reworded question with its
#: choices is ~100 tokens, and the call's reply is capped (`llm.ROUTES`).
#: Past this a long quiz keeps the rest in their stored wording, reshuffled.
REWORD_MAX = 20


@dataclass(slots=True)
class Reworded:
    questions: list[QuizVariantQuestion]
    reworded: int
    trace: dict = field(default_factory=dict)


def reword_prompt(questions: Sequence[QuizQuestion]) -> str:
    items = [{"n": n, "q": q.q, "choices": q.choices} for n, q in enumerate(questions, start=1)]
    return (
        "Reword each quiz question below so it tests exactly the same thing in different words: change the "
        "sentence structure and vocabulary of the question AND of every choice, so a student who only "
        "remembers the old wording gets no help from it.\n"
        "Rules:\n"
        "- Keep the meaning of the question and of every choice exactly. A choice that was right must stay "
        "right; a wrong one must stay wrong in the same way.\n"
        "- Keep the choices in the SAME order, one rewording per choice.\n"
        "- Keep every number, unit, name, formula and piece of math ($...$) exactly as written.\n"
        "- Keep any 'not', 'except' or 'least' — if a question asks for the exception, it still must.\n"
        "- If a question or choice can't be reworded without changing its meaning, return it unchanged.\n"
        'Reply with a JSON object only: {"items": [{"n": 1, "q": str, "choices": [str, ...]}]}.\n\n'
        f"Questions:\n{json.dumps(items, ensure_ascii=False)}"
    )


def parse_reworded(raw: str) -> dict[int, dict]:
    """The model's rewordings by question number; unusable entries dropped."""
    start, end = raw.find("{"), raw.rfind("}")
    data = None
    if start != -1 and end > start:
        try:
            data = loads_lenient(raw[start : end + 1])
        except (json.JSONDecodeError, ValueError):
            data = None
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        items = parse_items(raw)
    out: dict[int, dict] = {}
    for it in items:
        if isinstance(it, dict) and isinstance(it.get("n"), int) and not isinstance(it.get("n"), bool):
            out[it["n"]] = it
    return out


def shuffled(
    questions: Sequence[QuizQuestion],
    rewordings: dict[int, dict] | None = None,
    rng: random.Random | None = None,
) -> Reworded:
    """The retake: each question in its accepted rewording (or its stored
    wording), its choices reshuffled, and the questions in a new order —
    each carrying where it came from, so the attempt scores against the
    stored quiz."""
    rng = rng or random.Random()
    rewordings = rewordings or {}
    staged: list[tuple[QuizQuestion, int, bool]] = []
    rejected = 0
    for i, q in enumerate(questions):
        new = rewordings.get(i + 1)
        ok = False
        if new is not None:
            problems = question_checks.reword_problems(q.model_dump(), new)
            if problems:
                rejected += 1
            else:
                text = str(new["q"]).strip()
                choices = [str(c).strip() for c in new["choices"]]
                ok = text != q.q.strip() or choices != [c.strip() for c in q.choices]
                q = q.model_copy(update={"q": text, "choices": choices})
        staged.append((q, i, ok))

    reshuffled = shuffle_with_order([q for q, _, _ in staged], rng)
    out = [
        QuizVariantQuestion(**q.model_dump(), original_index=i, choice_order=order, reworded=ok)
        for (q, order), (_, i, ok) in zip(reshuffled, staged, strict=True)
    ]
    rng.shuffle(out)
    done = sum(1 for q in out if q.reworded)
    return Reworded(out, done, {"asked": len(questions), "returned": len(rewordings), "rejected": rejected, "reworded": done})


async def reword_quiz(
    questions: Sequence[QuizQuestion],
    *,
    complete: Complete = _complete,
    rng: random.Random | None = None,
) -> Reworded:
    """One call. Raises when the model fails; the caller decides what a
    retake without new wording should be."""
    with usage.task("quiz.reword"):
        raw = await asyncio.wait_for(
            complete(
                [{"role": "user", "content": reword_prompt(questions[:REWORD_MAX])}],
                settings.groq_model_fast,
                0.7,
                json_object=True,
            ),
            REWORD_TIMEOUT_S,
        )
    return shuffled(questions, parse_reworded(raw), rng)
