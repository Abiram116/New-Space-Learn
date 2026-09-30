"""The phone intake's "skipped the style questions" marker.

Phones ask three short questions and leave out learning style and depth,
which only shape the chat tutor. The skip is recorded so a desktop can offer
those two questions once — and must round-trip through the same
`student_model` JSON as every other intake answer, with no column behind it.
"""

from __future__ import annotations

import pytest

from app.deps import CurrentUser
from app.routers.me import account
from app.schemas import StudentModelIn, StudentModelOut

from .conftest import OWNER


def _blank_model() -> StudentModelOut:
    return StudentModelOut(
        learning_style=None,
        session_length_minutes=None,
        exam_context=None,
        teaching_preference=None,
        weak_areas=[],
        strong_areas=[],
        streak_days=0,
    )


@pytest.fixture
def user() -> CurrentUser:
    return CurrentUser(id=OWNER, email="s@example.com")


@pytest.fixture
def stub_service(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """The student-model service does a full snapshot; only the flag's
    plumbing is under test here, so it answers with a blank model and records
    what it was asked to store."""
    stored: list[dict] = []

    async def fake_get(_user_id: str) -> StudentModelOut:
        return _blank_model()

    async def fake_set(_user_id: str, patch: dict) -> StudentModelOut:
        stored.append(patch)
        return _blank_model()

    monkeypatch.setattr(account.student_model_service, "get", fake_get)
    monkeypatch.setattr(account.student_model_service, "set_explicit", fake_set)
    return stored


def test_the_field_is_optional_and_boolean() -> None:
    assert StudentModelIn().model_dump(exclude_unset=True) == {}
    assert StudentModelIn(intake_skipped_style=True).intake_skipped_style is True


def test_defaults_to_false_on_the_way_out() -> None:
    assert _blank_model().intake_skipped_style is False


async def test_get_reads_the_flag_from_stored_json(db, user, stub_service) -> None:
    db.seed(
        "user_settings",
        [{"user_id": OWNER, "student_model": {"session_length_minutes": 15, "intake_skipped_style": True}}],
    )
    out = await account.get_student_model(user)
    assert out.intake_skipped_style is True


async def test_get_is_false_without_the_key(db, user, stub_service) -> None:
    db.seed("user_settings", [{"user_id": OWNER, "student_model": {"session_length_minutes": 30}}])
    out = await account.get_student_model(user)
    assert out.intake_skipped_style is False


async def test_get_tolerates_a_missing_student_model(db, user, stub_service) -> None:
    db.seed("user_settings", [{"user_id": OWNER, "student_model": None}])
    out = await account.get_student_model(user)
    assert out.intake_skipped_style is False


async def test_patch_stores_and_echoes_the_flag(db, user, stub_service) -> None:
    db.seed("user_settings", [{"user_id": OWNER, "student_model": {}}])
    body = StudentModelIn(session_length_minutes=15, intake_skipped_style=True)
    out = await account.patch_student_model(body, user)
    assert stub_service == [{"session_length_minutes": 15, "intake_skipped_style": True}]
    assert out.intake_skipped_style is True


async def test_answering_on_desktop_clears_it(db, user, stub_service) -> None:
    db.seed(
        "user_settings",
        [{"user_id": OWNER, "student_model": {"intake_skipped_style": True}}],
    )
    body = StudentModelIn(
        learning_style="examples first, then the general rule",
        intake_skipped_style=False,
    )
    out = await account.patch_student_model(body, user)
    assert out.intake_skipped_style is False


async def test_an_unrelated_patch_keeps_it(db, user, stub_service) -> None:
    """Editing the goal in Settings must not silently drop the marker."""
    db.seed(
        "user_settings",
        [{"user_id": OWNER, "student_model": {"intake_skipped_style": True}}],
    )
    out = await account.patch_student_model(StudentModelIn(exam_context="GATE 2027"), user)
    assert out.intake_skipped_style is True
