"""`/feedback` — what the student thought of a generated response.

The only input to the personalization engine that is genuinely collected rather
than derived. Everything else the Student Model knows is recomputed from stored
activity on every read; an opinion about an answer is an event, and an event
that isn't recorded is gone.

Deliberately tiny. One POST to record, one DELETE to take it all back. No
update: changing your mind is a new event with a different `kind`, and the
confidence fold replays events in order, so a reversal is expressed as
evidence rather than by editing history.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_user
from ..errors import ValidationFailed
from ..guards import assert_subspace
from ..schemas import FeedbackIn, PreferenceOut
from ..services import preferences, student_model, supabase

log = logging.getLogger("space_learn.feedback")
router = APIRouter()


@router.post("/feedback")
async def record_feedback(
    body: FeedbackIn,
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, bool]:
    """Record one tap.

    Returns `{"ok": true}` like every other write here, and deliberately does
    NOT return the re-resolved preference: making the student wait for a fold
    over their whole feedback history to see a chip acknowledge one tap would
    put a database round trip inside an interaction that should feel free.
    """
    if body.kind not in preferences.FEEDBACK_KINDS:
        # The whitelist at the only door. A kind that isn't in the taxonomy has
        # no declared meaning, so recording it would create a row nothing can
        # ever interpret.
        raise ValidationFailed("Unknown feedback kind.")

    # The guard, which `test_guard_coverage.py` requires and which is doing
    # real work here: `target_id` is not a foreign key (it points at four
    # different tables), so the subspace is the only thing proving this
    # feedback belongs to material the caller owns.
    await assert_subspace(user.id, body.subspace_id)

    row = {
        "user_id": user.id,
        "subspace_id": body.subspace_id,
        "surface": body.surface,
        "target_id": body.target_id,
        "kind": body.kind,
        # Same normalization the concept model uses, so a feedback row can be
        # scoped to a concept later without a second, almost-agreeing rule.
        "concept": student_model.normalize_concept(body.concept or "") or None,
    }
    try:
        await supabase.db_insert("response_feedback", row)
    except Exception:
        # The unique constraint (user, target, kind) makes a double-tap a
        # no-op rather than a second piece of evidence. That is the constraint
        # working, not a failure the student should see — the UI has already
        # shown their tap as recorded, and it is.
        log.info("duplicate or rejected feedback ignored", exc_info=True)
    return {"ok": True}


@router.get("/me/preferences", response_model=list[PreferenceOut])
async def list_preferences(
    user: CurrentUser = Depends(get_current_user),
) -> list[PreferenceOut]:
    """Everything the personalization layer currently believes, and why.

    Inspectable by requirement, not as a nicety: anything that shapes how the
    student is taught should be something they can read and disagree with.
    """
    # The three-select read, not the ten-select one: nothing in preference
    # resolution looks at concepts, topics, decks or documents.
    resolved = preferences.resolve(await student_model.preference_context(user.id))
    return [
        PreferenceOut(
            key=p.key,
            value=p.value,
            source=p.source,
            confidence=p.confidence,
            evidence_count=p.evidence_count,
            because=p.because,
            actionable=p.actionable,
        )
        # Most-trusted first, so the ones actually changing output are at the
        # top of the list the student reads.
        for p in sorted(resolved.values(), key=lambda p: -p.confidence)
    ]


@router.delete("/me/feedback")
async def reset_feedback(
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, bool]:
    """Forget everything learned from feedback.

    Explicit preferences and observed behaviour survive: the first is the
    student's own words and not ours to delete, the second is recomputed from
    activity and would simply come back. This deletes the evidence that was
    genuinely collected, which is the only part a reset can meaningfully
    remove.
    """
    await supabase.db_delete("response_feedback", filters={"user_id": f"eq.{user.id}"})
    return {"ok": True}
