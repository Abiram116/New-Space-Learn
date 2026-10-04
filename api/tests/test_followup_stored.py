"""A stored suggestion is re-checked on the way out, so an odd old value never reaches the box."""

from app.services import followup


def test_a_stored_suggestion_is_shown_only_if_it_is_still_fit_to_show():
    assert followup.clean("Why scale by the square root of d?") == "Why scale by the square root of d?"
    assert followup.clean(None) is None
    assert followup.clean("not a question") is None
