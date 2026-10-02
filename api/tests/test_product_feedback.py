"""The feedback form: who may do what, and what counts as a valid answer.

Sending is the one write in the API open to signed-out visitors, so most of
this is about that door: validation, the bot trap, the limits, and that the
admin side is closed to everyone who is not on the list."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.errors import Unauthorized, ValidationFailed
from app.main import create_app
from app.routers import product_feedback as pf
from app.services import ratelimit, supabase

from .conftest import OWNER

Q = [
    {"id": "q-rate", "position": 10, "prompt": "Overall?", "kind": "rating", "options": [], "required": True, "active": True},
    {"id": "q-pick", "position": 20, "prompt": "Use it for?", "kind": "choice", "options": ["Notes", "Quizzes"], "required": True, "active": True},
    {"id": "q-many", "position": 30, "prompt": "Liked?", "kind": "multi", "options": ["Speed", "Design", "Sources"], "required": True, "active": True},
    {"id": "q-nps", "position": 40, "prompt": "Recommend?", "kind": "scale", "options": [], "required": True, "active": True},
    {"id": "q-next", "position": 50, "prompt": "Next?", "kind": "short", "options": [], "required": True, "active": True},
    {"id": "q-more", "position": 60, "prompt": "Anything else?", "kind": "long", "options": [], "required": False, "active": True},
]
GOOD = [
    {"question_id": "q-rate", "value": 4},
    {"question_id": "q-pick", "value": "Notes"},
    {"question_id": "q-many", "value": ["Speed", "Sources"]},
    {"question_id": "q-nps", "value": 9},
    {"question_id": "q-next", "value": "  Dark mode toggle  "},
]


@pytest.fixture
def world(monkeypatch):
    tables: dict[str, list[dict]] = {"feedback_questions": [dict(q) for q in Q], "product_feedback": []}

    async def db_select(table, *, filters=None, select="*", order=None, limit=None):
        rows = list(tables.get(table, []))
        for key, expr in (filters or {}).items():
            if expr.startswith("eq."):
                want = expr[3:]
                rows = [r for r in rows if str(r.get(key)).lower() == want.lower()]
        if order and order.startswith("position"):
            rows.sort(key=lambda r: r.get("position", 0), reverse="desc" in order.split(",")[0])
        return rows[:limit] if limit else rows

    async def db_insert(table, row):
        made = {"id": f"{table}-{len(tables[table])}", "created_at": "2026-10-02T10:00:00+00:00", "active": True, **row}
        tables[table].append(made)
        return [made]

    async def db_update(table, *, filters, patch):
        hit = [r for r in tables[table] if f"eq.{r['id']}" == filters.get("id")]
        for r in hit:
            r.update(patch)
        return hit

    async def db_delete(table, *, filters):
        tables[table] = [r for r in tables[table] if f"eq.{r['id']}" != filters.get("id")]

    for name, fn in [("db_select", db_select), ("db_insert", db_insert), ("db_update", db_update), ("db_delete", db_delete)]:
        monkeypatch.setattr(supabase, name, fn)
    async def verify(token):
        if not token.startswith("tok:"):
            raise Unauthorized("Sign in required.")
        return {"sub": OWNER, "email": token[4:]}

    monkeypatch.setattr(supabase, "verify_access_token", verify)
    monkeypatch.setattr(settings, "admin_emails", "boss@x.test, Second@X.test")
    ratelimit.reset()
    pf._clear_form_cache()
    return tables


def _client(email: str | None):
    """A client signed in as `email`, or signed out when None.

    Signed in by token (see `world`), not by overriding the dependency: the
    public endpoint reads the Authorization header itself, and that is the
    path worth exercising."""
    client = TestClient(create_app())
    if email is not None:
        client.headers["Authorization"] = f"Bearer tok:{email}"
    return client


def _send(client, answers=GOOD, **extra):
    return client.post("/api/v1/product-feedback", json={"source": "landing", "answers": answers, **extra})


# ── Sending ────────────────────────────────────────────────────────────


def test_anyone_can_read_the_form_and_only_active_questions_show(world):
    world["feedback_questions"][5]["active"] = False
    r = _client(None).get("/api/v1/feedback-form")
    assert r.status_code == 200
    assert [q["id"] for q in r.json()] == ["q-rate", "q-pick", "q-many", "q-nps", "q-next"]


def test_a_signed_out_visitor_can_send_and_the_prompt_is_stored_with_each_answer(world):
    r = _send(_client(None), contact_email="me@uni.test", page="/feedback")
    assert r.status_code == 201, r.text
    row = world["product_feedback"][0]
    assert row["user_id"] is None and row["contact_email"] == "me@uni.test" and row["source"] == "landing"
    assert [a["prompt"] for a in row["answers"]] == ["Overall?", "Use it for?", "Liked?", "Recommend?", "Next?"]
    assert row["answers"][4]["value"] == "Dark mode toggle"  # trimmed


def test_a_signed_in_sender_is_recorded_and_needs_no_email(world):
    r = _client("student@x.test").post(
        "/api/v1/product-feedback", json={"source": "settings", "answers": GOOD, "contact_email": "x@y.test"}
    )
    assert r.status_code == 201
    row = world["product_feedback"][0]
    assert row["user_id"] == OWNER and row["contact_email"] is None


def test_a_bad_token_is_refused_not_treated_as_a_visitor(world):
    r = _client(None).post(
        "/api/v1/product-feedback", json={"source": "landing", "answers": GOOD}, headers={"Authorization": "Bearer forged"}
    )
    assert r.status_code == 401
    assert world["product_feedback"] == []


def test_every_required_question_must_be_answered(world):
    r = _send(_client(None), [a for a in GOOD if a["question_id"] != "q-nps"])
    assert r.status_code == 422
    assert "Recommend?" in r.json()["error"]["message"]
    assert world["product_feedback"] == []


@pytest.mark.parametrize(
    "question_id,value",
    [
        ("q-rate", 6), ("q-rate", 0), ("q-rate", "5"), ("q-rate", True),
        ("q-nps", 11), ("q-nps", -1),
        ("q-pick", "Something else"), ("q-pick", ["Notes"]),
        ("q-many", ["Speed", "Hacked"]), ("q-many", "Speed"),
        ("q-next", "x" * 201),
    ],
)
def test_an_answer_must_fit_its_question(world, question_id, value):
    answers = [a if a["question_id"] != question_id else {"question_id": question_id, "value": value} for a in GOOD]
    assert _send(_client(None), answers).status_code == 422
    assert world["product_feedback"] == []


def test_answers_to_unknown_or_retired_questions_are_ignored(world):
    r = _send(_client(None), [*GOOD, {"question_id": "made-up", "value": "<script>"}])
    assert r.status_code == 201
    assert all(a["question_id"] != "made-up" for a in world["product_feedback"][0]["answers"])


def test_the_bot_trap_accepts_quietly_and_stores_nothing(world):
    r = _send(_client(None), website="http://spam.example")
    assert r.status_code == 201
    assert world["product_feedback"] == []


def test_one_sender_is_limited_per_hour(world):
    c = _client(None)
    codes = [_send(c).status_code for _ in range(6)]
    assert codes == [201] * 5 + [429]


def test_changing_address_does_not_get_past_the_overall_cap(world):
    c = _client(None)
    codes = [
        c.post("/api/v1/product-feedback", json={"source": "landing", "answers": GOOD},
               headers={"X-Forwarded-For": f"10.0.{i // 250}.{i % 250}"}).status_code
        for i in range(pf._ANONYMOUS_TOTAL + 1)
    ]
    assert codes[: pf._ANONYMOUS_TOTAL] == [201] * pf._ANONYMOUS_TOTAL
    assert codes[-1] == 429


def test_a_malformed_reply_address_is_dropped_not_refused(world):
    assert _send(_client(None), contact_email="not an email").status_code == 201
    assert world["product_feedback"][0]["contact_email"] is None


# ── Admin ──────────────────────────────────────────────────────────────

ADMIN_CALLS = [
    ("get", "/api/v1/admin/feedback/questions", None),
    ("post", "/api/v1/admin/feedback/questions", {"prompt": "New?", "kind": "short"}),
    ("patch", "/api/v1/admin/feedback/questions/q-rate", {"active": False}),
    ("delete", "/api/v1/admin/feedback/questions/q-rate", None),
    ("post", "/api/v1/admin/feedback/questions/reorder", {"ids": ["q-nps", "q-rate"]}),
    ("get", "/api/v1/admin/feedback/responses", None),
    ("get", "/api/v1/admin/feedback/summary", None),
]


@pytest.mark.parametrize("method,path,body", ADMIN_CALLS)
def test_the_admin_side_is_closed_to_ordinary_users(world, method, path, body):
    r = _client("student@x.test").request(method, path, json=body)
    assert r.status_code == 403, f"{method} {path}"


@pytest.mark.parametrize("method,path,body", ADMIN_CALLS)
def test_the_admin_side_is_closed_to_visitors(world, method, path, body):
    assert _client(None).request(method, path, json=body).status_code == 401


def test_admin_status_is_by_email_case_insensitive_and_only_a_hint(world):
    assert _client("SECOND@x.test").get("/api/v1/me/admin").json() == {"admin": True}
    assert _client("student@x.test").get("/api/v1/me/admin").json() == {"admin": False}


def test_an_admin_can_add_edit_reorder_retire_and_delete_questions(world):
    c = _client("boss@x.test")
    made = c.post("/api/v1/admin/feedback/questions",
                  json={"prompt": " Favourite subject? ", "kind": "choice", "options": ["Maths", " Maths ", "", "Physics"]})
    assert made.status_code == 201
    q = made.json()
    assert q["prompt"] == "Favourite subject?" and q["options"] == ["Maths", "Physics"] and q["position"] == 70

    assert c.patch(f"/api/v1/admin/feedback/questions/{q['id']}", json={"required": False}).json()["required"] is False
    assert c.patch(f"/api/v1/admin/feedback/questions/{q['id']}", json={"active": False}).json()["active"] is False
    assert all(x["id"] != q["id"] for x in _client(None).get("/api/v1/feedback-form").json())  # cache cleared

    assert c.post("/api/v1/admin/feedback/questions/reorder", json={"ids": ["q-nps", "q-rate"]}).status_code == 200
    order = [x["id"] for x in c.get("/api/v1/admin/feedback/questions").json()]
    assert order.index("q-nps") < order.index("q-rate")

    assert c.delete(f"/api/v1/admin/feedback/questions/{q['id']}").status_code == 200
    assert all(x["id"] != q["id"] for x in c.get("/api/v1/admin/feedback/questions").json())


def test_a_choice_question_needs_at_least_two_choices(world):
    r = _client("boss@x.test").post("/api/v1/admin/feedback/questions", json={"prompt": "Pick?", "kind": "choice", "options": ["Only"]})
    assert r.status_code == 422


def test_an_admin_reads_responses_without_seeing_who_sent_them(world):
    _send(_client("student@x.test"))
    row = _client("boss@x.test").get("/api/v1/admin/feedback/responses").json()[0]
    assert row["signed_in"] is True and "user_id" not in row
    assert row["answers"][0] == {"question_id": "q-rate", "prompt": "Overall?", "kind": "rating", "value": 4}


def test_summary_averages_numbers_and_tallies_choices():
    out = pf.summarise([
        [{"question_id": "a", "prompt": "Overall?", "kind": "rating", "value": 4},
         {"question_id": "b", "prompt": "Liked?", "kind": "multi", "value": ["Speed", "Design"]}],
        [{"question_id": "a", "prompt": "Overall?", "kind": "rating", "value": 5},
         {"question_id": "b", "prompt": "Liked?", "kind": "multi", "value": ["Speed"]}],
    ])
    by = {i.question_id: i for i in out.items}
    assert out.total == 2 and by["a"].average == 4.5 and by["b"].counts == {"Speed": 2, "Design": 1}


def test_validate_answers_skips_an_optional_blank():
    stored = pf.validate_answers(Q, {a["question_id"]: a["value"] for a in GOOD} | {"q-more": "   "})
    assert [a["question_id"] for a in stored] == ["q-rate", "q-pick", "q-many", "q-nps", "q-next"]
    with pytest.raises(ValidationFailed):
        pf.validate_answers(Q, {})
