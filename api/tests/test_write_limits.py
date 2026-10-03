"""Server-side limits on what a client may write."""

from __future__ import annotations

import pytest


def test_note_body_is_capped_and_skill_icon_is_never_an_emoji():
    from pydantic import ValidationError

    from app.schemas import NOTE_BODY_MAX, NoteCreate, NoteUpdate, SkillCreate

    NoteCreate(title="t", body_md="x" * NOTE_BODY_MAX)
    with pytest.raises(ValidationError):
        NoteCreate(title="t", body_md="x" * (NOTE_BODY_MAX + 1))
    with pytest.raises(ValidationError):
        NoteUpdate(body_md="x" * (NOTE_BODY_MAX + 1))
    assert SkillCreate(name="n", instructions="i").icon.isascii()


def test_rate_limit_windows_cannot_grow_without_bound(monkeypatch):
    """Keys carry a forgeable address; rotating it must not add an entry per
    request forever. Past the ceiling, a new key is refused, a known one still
    counts as usual."""
    from app.errors import RateLimited
    from app.services import ratelimit

    ratelimit.reset()
    monkeypatch.setattr(ratelimit, "_MAX_WINDOWS", 50)
    try:
        for i in range(50):
            ratelimit.consume_window(f"addr:{i}", limit=5, window_s=3600, message="busy")
        with pytest.raises(RateLimited):
            ratelimit.consume_window("addr:new", limit=5, window_s=3600, message="busy")
        assert len(ratelimit._windows) == 50  # noqa: SLF001
        ratelimit.consume_window("addr:0", limit=5, window_s=3600, message="busy")
    finally:
        ratelimit.reset()
