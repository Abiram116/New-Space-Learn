"""`QuizQuestion`'s defensive normalization of the richer fields (task 1).

An LLM fills in `difficulty`/`kind`/`misconceptions`/`prerequisites`, and it
gets them wrong sometimes — a bad enum value, a `misconceptions` list that
doesn't line up with `choices`, junk in `prerequisites`. The rule is: a bad
optional field drops silently, it never fails the whole question (only a
genuinely broken `q`/`choices`/`answer_index` does that, one layer up in
`quizzes._safe_parse_questions`). These tests pin that contract field by
field, since a validator that raises instead of dropping would surface as a
quiz that's silently short a question, which looks like nothing until
someone counts.
"""

from __future__ import annotations

from app.schemas import QuizQuestion


def _q(**overrides) -> dict:
    base = dict(q="What is X?", choices=["A", "B", "C", "D"], answer_index=0)
    base.update(overrides)
    return base


# ── difficulty / kind ─────────────────────────────────────────────────────


def test_valid_difficulty_and_kind_survive():
    q = QuizQuestion(**_q(difficulty="hard", kind="apply"))
    assert q.difficulty == "hard"
    assert q.kind == "apply"


def test_invalid_difficulty_drops_rather_than_raises():
    q = QuizQuestion(**_q(difficulty="impossible"))
    assert q.difficulty is None


def test_invalid_kind_drops_rather_than_raises():
    q = QuizQuestion(**_q(kind="essay"))
    assert q.kind is None


def test_missing_difficulty_and_kind_are_none():
    q = QuizQuestion(**_q())
    assert q.difficulty is None
    assert q.kind is None


# ── misconceptions ────────────────────────────────────────────────────────


def test_misconceptions_aligned_with_choices_survive():
    q = QuizQuestion(**_q(
        answer_index=1,
        misconceptions=["confuses A with B", None, "thinks C is the base case", "off by one"],
    ))
    assert q.misconceptions == [
        "confuses A with B", None, "thinks C is the base case", "off by one",
    ]


def test_the_correct_index_is_forced_null_even_if_the_model_filled_it_in():
    """The correct choice must read null — a model that describes a
    'misconception' behind the right answer would poison the one signal
    `next_action`'s misconception ranking (task 7) relies on."""
    q = QuizQuestion(**_q(
        answer_index=0,
        misconceptions=["a wrong explanation for the RIGHT answer", "b", "c", "d"],
    ))
    assert q.misconceptions[0] is None


def test_wrong_length_misconceptions_list_drops_entirely():
    q = QuizQuestion(**_q(misconceptions=["only one"]))
    assert q.misconceptions is None


def test_misconceptions_not_a_list_drops_entirely():
    q = QuizQuestion(**_q(misconceptions="confuses A with B"))
    assert q.misconceptions is None


def test_a_non_string_entry_anywhere_drops_the_whole_list():
    """One malformed entry invalidates the field rather than being patched
    around — a partially-repaired list risks misattributing a misconception
    to the wrong choice, which is worse than having none at all."""
    q = QuizQuestion(**_q(answer_index=0, misconceptions=[None, 42, "c", ["nested"]]))
    assert q.misconceptions is None


def test_overlong_misconception_text_is_truncated_not_rejected():
    long_text = "x" * 300
    q = QuizQuestion(**_q(answer_index=1, misconceptions=[long_text, None, "c", "d"]))
    assert q.misconceptions[0] is not None
    assert len(q.misconceptions[0]) <= 80


# ── prerequisites ─────────────────────────────────────────────────────────


def test_valid_prerequisites_survive_capped_at_two():
    q = QuizQuestion(**_q(prerequisites=["Bellman equation", "Value iteration", "extra one"]))
    assert q.prerequisites == ["Bellman equation", "Value iteration"]


def test_junk_entries_in_prerequisites_are_filtered_not_fatal():
    q = QuizQuestion(**_q(prerequisites=["Bellman equation", 42, "  ", None]))
    assert q.prerequisites == ["Bellman equation"]


def test_empty_prerequisites_after_filtering_becomes_none():
    q = QuizQuestion(**_q(prerequisites=["   ", 7]))
    assert q.prerequisites is None


def test_prerequisites_not_a_list_drops_entirely():
    q = QuizQuestion(**_q(prerequisites="Bellman equation"))
    assert q.prerequisites is None


def test_missing_prerequisites_is_none():
    q = QuizQuestion(**_q())
    assert q.prerequisites is None


# ── Backward compatibility ─────────────────────────────────────────────────


def test_an_old_quiz_with_none_of_the_new_fields_still_parses():
    """Every quiz generated before task 1 shipped has no `difficulty`,
    `kind`, `misconceptions` or `prerequisites` key at all — this must keep
    working exactly like before, everywhere the field is read as `None`."""
    q = QuizQuestion(q="Old question", choices=["A", "B"], answer_index=0)
    assert q.difficulty is None
    assert q.kind is None
    assert q.misconceptions is None
    assert q.prerequisites is None


# ── Generated questions must be answerable ─────────────────────────────


def _raw(*items: dict) -> str:
    import json

    return json.dumps(list(items))


def _q(**over) -> dict:
    base = {"q": "What is 2+2?", "choices": ["1", "2", "3", "4"], "answer_index": 3}
    base.update(over)
    return base


def test_unanswerable_generated_questions_are_dropped():
    from app.services.quiz_agent import _usable, parse_items

    good = _q(explanation="Two and two make four.", source=1)
    raw = _raw(
        good,
        {**good, "answer_index": 4},  # past the end
        {**good, "answer_index": -1},
        {**good, "choices": ["a", "b", "c"]},  # too few
        {**good, "choices": ["a", "b", "c", "d", "e"]},  # too many
        {**good, "choices": ["a", "a", "b", "c"]},  # duplicates
        {**good, "choices": ["a", " ", "b", "c"]},  # blank
        {**good, "q": "  "},
        "not an object",
    )
    kept, trace = _usable(parse_items(raw), 1, [])
    assert len(kept) == 1 and kept[0]["answer_index"] == 3
    assert trace == {"malformed": 7, "repeats": 0}
