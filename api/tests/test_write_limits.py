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
