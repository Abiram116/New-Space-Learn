"""The feedback form: its questions, what people answer, and the admin side.

Three audiences, three levels of access:

- **Anyone** may read the active questions and send the form — including a
  signed-out visitor on the landing page. That makes it the one write in the
  API open to the world, so it is rate-limited per person and overall, carries
  a hidden field that only a bot fills in, and every answer is checked against
  the question it claims to answer.
- **Admins** (`ADMIN_EMAILS`, see `deps.require_admin`) manage the questions
  and read the responses.
- Nobody reads responses from the browser directly: both tables have row-level
  security on with no policies, so only this API can touch them.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from fastapi import APIRouter, Depends, Request

from ..config import settings
from ..deps import CurrentUser, get_current_user, get_optional_user, require_admin
from ..errors import NotFound, ValidationFailed
from ..schemas import (
    FEEDBACK_LONG_MAX,
    FEEDBACK_OPTION_MAX,
    FEEDBACK_OPTIONS_MAX,
    FEEDBACK_SHORT_MAX,
    AdminOut,
    FeedbackQuestionCreate,
    FeedbackQuestionOut,
    FeedbackQuestionUpdate,
    FeedbackReorder,
    FeedbackSummaryItem,
    FeedbackSummaryOut,
    OkOut,
    ProductFeedbackIn,
    ProductFeedbackOut,
)
from ..services import supabase
from ..services.ratelimit import consume_window

log = logging.getLogger("space_learn.product_feedback")
router = APIRouter()

#: Per person: a form, not a chat. Per hour.
_PER_PERSON = 5
#: All signed-out senders together — the backstop if someone rotates addresses.
_ANONYMOUS_TOTAL = 120
_WINDOW_S = 3600.0
_TOO_MANY = "You've sent feedback a few times already. Try again in a little while."

_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,189}\.[^@\s]{2,}$")

# The active questions are read on every form open and change a few times a
# year. One minute in memory keeps a public endpoint from being a database
# query per visitor; admin writes clear it.
_FORM_TTL_S = 60.0
_form_cache: tuple[float, list[dict[str, Any]]] | None = None


def _clear_form_cache() -> None:
    global _form_cache
    _form_cache = None


async def _active_questions() -> list[dict[str, Any]]:
    global _form_cache
    now = time.monotonic()
    if _form_cache and _form_cache[0] > now:
        return _form_cache[1]
    rows = await supabase.db_select(
        "feedback_questions", filters={"active": "eq.true"}, order="position.asc,created_at.asc"
    )
    _form_cache = (now + _FORM_TTL_S, rows)
    return rows


def _to_question(row: dict[str, Any]) -> FeedbackQuestionOut:
    return FeedbackQuestionOut(
        id=row["id"],
        position=int(row.get("position") or 0),
        prompt=row["prompt"],
        kind=row["kind"],
        options=[str(o) for o in (row.get("options") or [])],
        required=bool(row.get("required", True)),
        active=bool(row.get("active", True)),
    )


# ── Checking an answer against its question ────────────────────────────


def _clean_options(kind: str, options: list[str]) -> list[str]:
    """The choices for a `choice`/`multi` question: trimmed, unique, bounded."""
    if kind not in ("choice", "multi"):
        return []
    seen: list[str] = []
    for raw in options:
        text = str(raw).strip()
        if not text or text in seen:
            continue
        if len(text) > FEEDBACK_OPTION_MAX:
            raise ValidationFailed(f"Keep each choice under {FEEDBACK_OPTION_MAX} characters.")
        seen.append(text)
    if len(seen) < 2:
        raise ValidationFailed("Give at least two choices.")
    if len(seen) > FEEDBACK_OPTIONS_MAX:
        raise ValidationFailed(f"A question can have at most {FEEDBACK_OPTIONS_MAX} choices.")
    return seen


def _blank(value: object) -> bool:
    return value is None or value == "" or value == [] or (isinstance(value, str) and not value.strip())


def _check(question: dict[str, Any], value: object) -> int | str | list[str]:
    """`value` as a valid answer to `question`, or ValidationFailed."""
    kind = question["kind"]
    bad = ValidationFailed(f"That answer doesn't fit the question “{question['prompt']}”.")
    if kind in ("rating", "scale"):
        low, high = (1, 5) if kind == "rating" else (0, 10)
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            raise bad
        return value
    if kind == "choice":
        if not isinstance(value, str) or value not in (question.get("options") or []):
            raise bad
        return value
    if kind == "multi":
        options = question.get("options") or []
        if not isinstance(value, list) or not value or any(v not in options for v in value):
            raise bad
        return list(dict.fromkeys(value))
    limit = FEEDBACK_SHORT_MAX if kind == "short" else FEEDBACK_LONG_MAX
    if not isinstance(value, str):
        raise bad
    text = value.strip()
    if len(text) > limit:
        raise ValidationFailed(f"Keep “{question['prompt']}” under {limit} characters.")
    return text


def validate_answers(questions: list[dict[str, Any]], answers: dict[str, object]) -> list[dict[str, Any]]:
    """The submission as it will be stored: one entry per answered question,
    with the prompt copied in so it still reads right after the question is
    edited or retired. Raises on a missing required answer or a wrong one."""
    stored: list[dict[str, Any]] = []
    for q in questions:
        value = answers.get(q["id"])
        if _blank(value):
            if q.get("required", True):
                raise ValidationFailed(f"Please answer: “{q['prompt']}”")
            continue
        stored.append(
            {"question_id": q["id"], "prompt": q["prompt"], "kind": q["kind"], "value": _check(q, value)}
        )
    return stored


def _client_address(request: Request) -> str:
    """Best-effort address of the sender, for rate limiting only (never stored).
    Behind the host's proxy the socket peer is the proxy, so the forwarded
    header is used; it can be forged, which is why there is an overall cap too."""
    forwarded = request.headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    return (first or (request.client.host if request.client else "") or "unknown")[:64]


# ── Public ─────────────────────────────────────────────────────────────


@router.get("/feedback-form", response_model=list[FeedbackQuestionOut])
async def feedback_form() -> list[FeedbackQuestionOut]:
    """The questions to ask, in order. Public: the landing page shows the form."""
    return [_to_question(r) for r in await _active_questions()]


@router.post("/product-feedback", response_model=OkOut, status_code=201)
async def send_feedback(
    body: ProductFeedbackIn,
    request: Request,
    user: CurrentUser | None = Depends(get_optional_user),
) -> OkOut:
    # A person never sees this field. Answer as if it worked, store nothing.
    if body.website:
        return OkOut()

    who = f"feedback:user:{user.id}" if user else f"feedback:addr:{_client_address(request)}"
    consume_window(who, limit=_PER_PERSON, window_s=_WINDOW_S, message=_TOO_MANY)
    if user is None:
        consume_window(
            "feedback:anonymous",
            limit=_ANONYMOUS_TOTAL,
            window_s=_WINDOW_S,
            message="We're getting a lot of feedback right now. Please try again later.",
        )

    answers = validate_answers(
        await _active_questions(), {a.question_id: a.value for a in body.answers}
    )
    if not answers:
        raise ValidationFailed("There's nothing to send yet.")

    email = (body.contact_email or "").strip() or None
    if email and (user is not None or not _EMAIL.match(email)):
        # Signed-in senders are already identified; a malformed address is dropped
        # rather than refused — the feedback matters more than the reply-to.
        email = None

    await supabase.db_insert(
        "product_feedback",
        {
            "user_id": user.id if user else None,
            "source": body.source,
            "contact_email": email,
            "answers": answers,
            "page": (body.page or "")[:300] or None,
            "user_agent": (request.headers.get("user-agent") or "")[:300] or None,
        },
    )
    return OkOut()


# ── Admin ──────────────────────────────────────────────────────────────


@router.get("/me/admin", response_model=AdminOut)
async def am_i_admin(user: CurrentUser = Depends(get_current_user)) -> AdminOut:
    """Whether to show the admin tools. Showing them is all this decides —
    every admin endpoint checks again for itself."""
    return AdminOut(admin=bool(user.email and user.email.strip().lower() in settings.admin_email_set))


@router.get("/admin/feedback/questions", response_model=list[FeedbackQuestionOut])
async def list_questions(_: CurrentUser = Depends(require_admin)) -> list[FeedbackQuestionOut]:
    rows = await supabase.db_select("feedback_questions", order="position.asc,created_at.asc")
    return [_to_question(r) for r in rows]


@router.post("/admin/feedback/questions", response_model=FeedbackQuestionOut, status_code=201)
async def create_question(
    body: FeedbackQuestionCreate, _: CurrentUser = Depends(require_admin)
) -> FeedbackQuestionOut:
    existing = await supabase.db_select(
        "feedback_questions", select="position", order="position.desc", limit=1
    )
    position = (int(existing[0]["position"]) if existing else 0) + 10
    row = (
        await supabase.db_insert(
            "feedback_questions",
            {
                "position": position,
                "prompt": body.prompt.strip(),
                "kind": body.kind,
                "options": _clean_options(body.kind, body.options),
                "required": body.required,
            },
        )
    )[0]
    _clear_form_cache()
    return _to_question(row)


@router.patch("/admin/feedback/questions/{question_id}", response_model=FeedbackQuestionOut)
async def update_question(
    question_id: str, body: FeedbackQuestionUpdate, _: CurrentUser = Depends(require_admin)
) -> FeedbackQuestionOut:
    rows = await supabase.db_select("feedback_questions", filters={"id": f"eq.{question_id}"}, limit=1)
    if not rows:
        raise NotFound("Question not found.")
    patch = body.model_dump(exclude_unset=True, exclude_none=True)
    if "prompt" in patch:
        patch["prompt"] = patch["prompt"].strip()
    if "options" in patch:
        patch["options"] = _clean_options(rows[0]["kind"], patch["options"])
    if not patch:
        return _to_question(rows[0])
    updated = await supabase.db_update(
        "feedback_questions", filters={"id": f"eq.{question_id}"}, patch=patch
    )
    _clear_form_cache()
    return _to_question(updated[0] if updated else {**rows[0], **patch})


@router.delete("/admin/feedback/questions/{question_id}", response_model=OkOut)
async def delete_question(question_id: str, _: CurrentUser = Depends(require_admin)) -> OkOut:
    """Remove a question for good. Answers already given keep their own copy of
    the prompt, so nothing that was said is lost."""
    await supabase.db_delete("feedback_questions", filters={"id": f"eq.{question_id}"})
    _clear_form_cache()
    return OkOut()


@router.post("/admin/feedback/questions/reorder", response_model=OkOut)
async def reorder_questions(body: FeedbackReorder, _: CurrentUser = Depends(require_admin)) -> OkOut:
    for index, question_id in enumerate(dict.fromkeys(body.ids)):
        await supabase.db_update(
            "feedback_questions",
            filters={"id": f"eq.{question_id}"},
            patch={"position": (index + 1) * 10},
        )
    _clear_form_cache()
    return OkOut()


@router.get("/admin/feedback/responses", response_model=list[ProductFeedbackOut])
async def list_responses(
    limit: int = 50, before: str | None = None, _: CurrentUser = Depends(require_admin)
) -> list[ProductFeedbackOut]:
    """Newest first. `before` (an ISO timestamp) pages back through older ones."""
    filters: dict[str, str] = {}
    if before and re.fullmatch(r"[0-9T:.+\-Z ]{10,40}", before):
        filters["created_at"] = f"lt.{before}"
    rows = await supabase.db_select(
        "product_feedback",
        filters=filters,
        order="created_at.desc",
        limit=max(1, min(limit, 100)),
    )
    return [
        ProductFeedbackOut(
            id=r["id"],
            created_at=r["created_at"],
            source=r["source"],
            signed_in=r.get("user_id") is not None,
            contact_email=r.get("contact_email"),
            page=r.get("page"),
            answers=r.get("answers") or [],
        )
        for r in rows
    ]


#: How many recent responses the summary is computed over.
_SUMMARY_WINDOW = 500


@router.get("/admin/feedback/summary", response_model=FeedbackSummaryOut)
async def summary(_: CurrentUser = Depends(require_admin)) -> FeedbackSummaryOut:
    """Averages and tallies over the most recent responses."""
    rows = await supabase.db_select(
        "product_feedback", select="answers", order="created_at.desc", limit=_SUMMARY_WINDOW
    )
    return summarise([r.get("answers") or [] for r in rows])


def summarise(responses: list[list[dict[str, Any]]]) -> FeedbackSummaryOut:
    items: dict[str, FeedbackSummaryItem] = {}
    totals: dict[str, int] = {}
    for answers in responses:
        for a in answers:
            qid = str(a.get("question_id"))
            item = items.setdefault(
                qid,
                FeedbackSummaryItem(
                    question_id=qid, prompt=str(a.get("prompt", "")), kind=str(a.get("kind", "")), responses=0
                ),
            )
            item.responses += 1
            value = a.get("value")
            if item.kind in ("rating", "scale") and isinstance(value, int):
                totals[qid] = totals.get(qid, 0) + value
            elif item.kind == "choice" and isinstance(value, str):
                item.counts[value] = item.counts.get(value, 0) + 1
            elif item.kind == "multi" and isinstance(value, list):
                for v in value:
                    item.counts[str(v)] = item.counts.get(str(v), 0) + 1
    for qid, total in totals.items():
        items[qid].average = round(total / items[qid].responses, 2)
    return FeedbackSummaryOut(total=len(responses), items=list(items.values()))
