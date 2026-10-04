"""History is shortened, de-marked and bounded — and what a follow-up needs survives."""

from app.services import context_budget as cb


def turn(role: str, text: str) -> dict[str, str]:
    return {"role": role, "content": text}


def test_the_newest_answer_is_kept_nearly_whole_and_older_ones_keep_their_opening():
    long = "First the answer. " + "More detail here. " * 200
    h = [turn("user", "q1"), turn("assistant", long), turn("user", "q2"), turn("assistant", long)]
    out = cb.fit_history(h)
    older, newest = out[1]["content"], out[3]["content"]
    assert older.startswith("First the answer.")
    assert len(older) <= cb.OLDER_ANSWER_CHARS + len(cb.ELLIPSIS)
    assert len(newest) > len(older)
    assert len(newest) <= cb.RECENT_ANSWER_CHARS + len(cb.ELLIPSIS)


def test_stale_citation_markers_are_removed_from_past_answers():
    h = [turn("user", "q"), turn("assistant", "Attention weighs tokens [[1]]. It scales by sqrt(d) [[2]][[3]].")]
    out = cb.fit_history(h)
    assert "[[" not in out[1]["content"]
    assert out[1]["content"] == "Attention weighs tokens. It scales by sqrt(d)."


def test_short_messages_pass_through_untouched():
    h = [turn("user", "What is a class?"), turn("assistant", "A blueprint for objects.")]
    assert cb.fit_history(h) == h


def test_the_oldest_turns_go_first_when_over_budget_and_the_last_two_always_stay():
    h = [turn("user" if i % 2 == 0 else "assistant", f"{i} " + "x" * 500) for i in range(10)]
    out = cb.fit_history(h, max_chars=1200)
    assert [m["content"][0] for m in out][-2:] == ["8", "9"]
    assert len(out) < len(h)
    assert len(cb.fit_history(h[:2], max_chars=10)) == 2


def test_a_skill_that_asks_for_forty_turns_still_cannot_exceed_the_ceiling():
    h = [turn("user" if i % 2 == 0 else "assistant", "y" * 650) for i in range(40)]
    out = cb.fit_history(h)
    assert sum(len(m["content"]) for m in out) <= cb.MAX_CHARS


def test_it_cuts_at_the_end_of_a_sentence_when_it_can():
    out = cb.shorten("One sentence here. Two sentence here. Three sentence here.", 40)
    assert out == "One sentence here. Two sentence here." + cb.ELLIPSIS  # the last full sentence that fits


def test_nothing_in_nothing_out():
    assert cb.fit_history([]) == []
