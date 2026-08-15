"""Who may activate which Skill.

`activate_skill` calls `_assert_can_use_skill`, which fetches the row and then
delegates the actual decision to `_can_use_skill` — a pure predicate, pulled
out so the authorization rule itself is what a test exercises, not the fetch
around it (same discipline as `test_note_prompt.py`'s `_grounding_rule`).

The rule: a library skill (`is_library=True`, seeded with `user_id=None`) is
everyone's to activate. A private skill is only its owner's — a student must
not be able to switch another account's custom Skill on in their own space.
"""

from app.routers.skills import _can_use_skill

OWNER = "11ce5563-b933-44be-8131-7d7304947d0b"
OTHER = "22222222-2222-2222-2222-222222222222"


def test_owner_can_use_their_own_private_skill() -> None:
    skill = {"id": "s1", "user_id": OWNER, "is_library": False}
    assert _can_use_skill(skill, OWNER) is True


def test_a_different_user_cannot_use_a_private_skill() -> None:
    skill = {"id": "s1", "user_id": OWNER, "is_library": False}
    assert _can_use_skill(skill, OTHER) is False


def test_anyone_can_use_a_library_skill_including_its_owner() -> None:
    skill = {"id": "s1", "user_id": OWNER, "is_library": True}
    assert _can_use_skill(skill, OWNER) is True
    assert _can_use_skill(skill, OTHER) is True


def test_a_library_skill_with_no_owner_is_still_usable_by_anyone() -> None:
    """The real shape library rows are seeded in: `user_id` is null, owned by
    nobody, `is_library=True`. This is the actual production case, not an
    edge case invented for the test."""
    skill = {"id": "s1", "user_id": None, "is_library": True}
    assert _can_use_skill(skill, OTHER) is True


def test_a_private_skill_with_no_owner_is_unusable_by_anyone() -> None:
    """Guards the boolean logic itself: `is_library=False` must gate on
    ownership even when `user_id` is absent, rather than a missing owner
    being read as 'nobody to conflict with, so allow it'."""
    skill = {"id": "s1", "is_library": False}
    assert _can_use_skill(skill, OTHER) is False
