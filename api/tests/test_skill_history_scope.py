"""What an active Skill's `memory_scope` actually does.

The UI's "Remembers: This session / This topic / Everything" is not a
scope-of-activation control — a Skill is only ever active in the subspaces
it was explicitly added to (`subspace_skills`), regardless of this setting.
`memory_scope` controls exactly one thing: how many prior chat turns
`send_chat` loads before building the prompt. `_history_limit` is that
decision, pulled out of the request handler so it's reachable without
mocking a live chat POST.
"""

from app.routers.subspace_chat import _history_limit


def test_no_active_skills_uses_the_default_window() -> None:
    assert _history_limit([]) == 8


def test_session_scope_is_the_short_window() -> None:
    assert _history_limit([{"memory_scope": "session"}]) == 8


def test_topic_scope_is_a_longer_window() -> None:
    assert _history_limit([{"memory_scope": "topic"}]) == 20


def test_all_scope_is_the_widest_window() -> None:
    assert _history_limit([{"memory_scope": "all"}]) == 40


def test_multiple_active_skills_use_the_widest_any_of_them_asks_for() -> None:
    """One skill still set to 'session' must not shrink the window a second,
    simultaneously active skill asked to widen to 'all' — a skill can only
    ask for more context than the default, never take it away from another
    active skill that wants it."""
    skills = [{"memory_scope": "session"}, {"memory_scope": "all"}]
    assert _history_limit(skills) == 40


def test_missing_memory_scope_falls_back_to_the_default() -> None:
    """A skill row from before memory_scope existed, or a malformed one."""
    assert _history_limit([{}]) == 8


def test_unknown_memory_scope_value_falls_back_to_the_default() -> None:
    assert _history_limit([{"memory_scope": "forever"}]) == 8
