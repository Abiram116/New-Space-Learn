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
from app.services import admin_gate, feedback_summary, ratelimit, supabase

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


PASSWORD = "correct horse battery"


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
    monkeypatch.setattr(settings, "admin_password_hash", admin_gate.hash_password(PASSWORD))
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
    ("delete", "/api/v1/admin/feedback/responses/product_feedback-0", None),
    ("get", "/api/v1/admin/feedback/summary", None),
]


def _admin():
    """A client that unlocked the admin side with the password. Signed out:
    the admin side belongs to no account."""
    client = _client(None)
    r = client.post("/api/v1/admin/unlock", json={"password": PASSWORD})
    assert r.status_code == 200, r.text
    client.headers["X-Admin-Token"] = r.json()["token"]
    return client


@pytest.mark.parametrize("method,path,body", ADMIN_CALLS)
def test_the_admin_side_is_closed_without_the_password(world, method, path, body):
    """Signed in or not: an account opens nothing here. And it is a 403, never
    a 401 — a 401 would sign a student out of the app."""
    for client in (_client(None), _client("student@x.test")):
        assert client.request(method, path, json=body).status_code == 403, f"{method} {path}"


@pytest.mark.parametrize("token", ["", "nonsense", "9999999999.deadbeef", "1.abc", "-5.x"])
def test_a_made_up_token_opens_nothing(world, token):
    r = _client(None).get("/api/v1/admin/feedback/responses", headers={"X-Admin-Token": token})
    assert r.status_code == 403


def test_the_wrong_password_is_refused_and_guesses_are_limited(world):
    c = _client(None)
    codes = [c.post("/api/v1/admin/unlock", json={"password": f"guess-{i}"}).status_code for i in range(6)]
    assert codes == [403] * 5 + [429]
    # Out of tries: even the right one waits.
    assert c.post("/api/v1/admin/unlock", json={"password": PASSWORD}).status_code == 429


def test_with_no_password_set_the_admin_side_is_closed(world, monkeypatch):
    monkeypatch.setattr(settings, "admin_password_hash", "")
    assert _client(None).post("/api/v1/admin/unlock", json={"password": ""}).status_code == 422
    assert _client(None).post("/api/v1/admin/unlock", json={"password": "anything"}).status_code == 403
    token, _ = admin_gate.issue_token()
    assert admin_gate.check_token(token) is False


def test_a_token_expires_and_dies_when_the_password_changes(world, monkeypatch):
    token, expires = admin_gate.issue_token(now=1000)
    assert expires == 1000 + admin_gate.SESSION_S
    assert admin_gate.check_token(token, now=1000 + admin_gate.SESSION_S - 1)
    assert not admin_gate.check_token(token, now=1000 + admin_gate.SESSION_S + 1)
    assert not admin_gate.check_token(f"{expires + 60}.{token.split('.')[1]}", now=1000)  # stretched
    monkeypatch.setattr(settings, "admin_password_hash", admin_gate.hash_password("a different one"))
    assert not admin_gate.check_token(token, now=1000)


def test_the_hash_does_not_contain_the_password_and_is_salted():
    one, two = admin_gate.hash_password(PASSWORD), admin_gate.hash_password(PASSWORD)
    assert one != two and PASSWORD not in one and one.startswith("scrypt:")


def test_an_admin_can_add_edit_reorder_retire_and_delete_questions(world):
    c = _admin()
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
    r = _admin().post("/api/v1/admin/feedback/questions", json={"prompt": "Pick?", "kind": "choice", "options": ["Only"]})
    assert r.status_code == 422


def test_an_admin_reads_responses_without_seeing_who_sent_them_and_can_delete_one(world):
    _send(_client("student@x.test"))
    c = _admin()
    row = c.get("/api/v1/admin/feedback/responses").json()[0]
    assert row["signed_in"] is True and "user_id" not in row
    assert row["answers"][0] == {"question_id": "q-rate", "prompt": "Overall?", "kind": "rating", "value": 4}
    assert c.delete(f"/api/v1/admin/feedback/responses/{row['id']}").status_code == 200
    assert world["product_feedback"] == []


def test_the_summary_endpoint_reads_what_was_sent(world):
    _send(_client(None), contact_email="me@uni.test")
    out = _admin().get("/api/v1/admin/feedback/summary?days=7").json()
    assert out["total"] == 1 and out["days"] == 7 and out["want_reply"] == 1
    assert out["takeaways"][0].startswith("1 response in the last 7 days")


# ── What the summary works out ─────────────────────────────────────────


def _row(day, rating, nps, liked, text, **extra):
    return {
        "created_at": f"2026-10-{day:02d}T09:00:00+00:00", "source": "landing", "user_id": None, "contact_email": None,
        "answers": [
            {"question_id": "a", "prompt": "Overall?", "kind": "rating", "value": rating},
            {"question_id": "n", "prompt": "Recommend?", "kind": "scale", "value": nps},
            {"question_id": "b", "prompt": "Liked?", "kind": "multi", "value": liked},
            {"question_id": "t", "prompt": "Next?", "kind": "long", "value": text},
        ],
        **extra,
    }


ROWS = [
    _row(2, 5, 10, ["Speed", "Design"], "Offline flashcards please", user_id="u1"),
    _row(2, 4, 9, ["Speed"], "Flashcards on my phone, offline", contact_email="a@b.test"),
    _row(1, 1, 3, ["Design"], "The upload kept failing"),
    _row(1, 4, 7, ["Speed"], "   "),
]


def _summary(**kw):
    from datetime import date

    return feedback_summary.summarise(ROWS, days=7, today=date(2026, 10, 2), **kw)


def test_summary_numbers():
    by = {i.question_id: i for i in _summary().items}
    rating, nps = by["a"], by["n"]
    assert (rating.average, rating.median, rating.positive_share) == (3.5, 4.0, 75)
    assert rating.distribution == {"1": 1, "2": 0, "3": 0, "4": 2, "5": 1}
    assert (nps.promoters, nps.passives, nps.detractors, nps.nps) == (2, 1, 1, 25)
    assert list(by["b"].counts.items()) == [("Speed", 3), ("Design", 2)]  # most picked first


def test_summary_words_and_whose_they_are():
    text = {i.question_id: i for i in _summary().items}["t"]
    assert text.responses == 4 and len(text.texts) == 3  # the blank one is not a comment
    assert [(k.word, k.count) for k in text.keywords] == [("flashcards", 2), ("offline", 2)]
    assert [t.score for t in text.texts] == [5, 4, 1]  # each carries its writer's rating


def test_summary_people_days_and_the_period_before():
    out = _summary(previous=[_row(20, 2, 5, ["Design"], "meh")])
    assert (out.total, out.previous_total, out.signed_in, out.visitors, out.want_reply) == (4, 1, 1, 3, 1)
    assert len(out.by_day) == 7 and [d.count for d in out.by_day[-2:]] == [2, 2] and out.by_day[-1].date == "2026-10-02"
    assert {i.question_id: i for i in out.items}["a"].previous_average == 2.0
    text = " ".join(out.takeaways)
    assert "up from 1" in text and "averages 3.5 out of 5, up from 2" in text
    assert "Recommend score +25" in text and "Speed (75% of answers)" in text
    assert "1 written answer comes from people who rated it 1 or 2" in text and "1 visitor left an email" in text


def test_summary_of_nothing_is_empty_not_an_error():
    out = feedback_summary.summarise([], days=30)
    assert out.total == 0 and out.takeaways == [] and out.items == [] and len(out.by_day) == 30


# ── "Tell us more" after a choice ──────────────────────────────────────


def test_a_choice_that_asks_for_more_keeps_what_was_typed(world):
    world["feedback_questions"][1]["detail_options"] = ["Quizzes"]
    answers = [a | {"detail": "  the timer froze  "} if a["question_id"] == "q-pick" else a for a in GOOD]
    answers[1] = {"question_id": "q-pick", "value": "Quizzes", "detail": "  the timer froze  "}
    assert _send(_client(None), answers).status_code == 201
    stored = world["product_feedback"][0]["answers"][1]
    assert stored["value"] == "Quizzes" and stored["detail"] == "the timer froze"


def test_detail_is_dropped_when_the_picked_choice_does_not_ask(world):
    world["feedback_questions"][1]["detail_options"] = ["Quizzes"]
    answers = list(GOOD)
    answers[1] = {"question_id": "q-pick", "value": "Notes", "detail": "sneaked in"}
    answers[0] = {"question_id": "q-rate", "value": 4, "detail": "not a choice at all"}
    assert _send(_client(None), answers).status_code == 201
    assert all("detail" not in a for a in world["product_feedback"][0]["answers"])
    too_long = [{"question_id": "q-pick", "value": "Quizzes", "detail": "x" * 501}]
    assert _send(_client(None), too_long).status_code == 422


def test_an_admin_sets_which_choices_ask_and_a_removed_choice_stops_asking(world):
    c = _admin()
    made = c.post("/api/v1/admin/feedback/questions", json={
        "prompt": "Did it work?", "kind": "choice", "options": ["Yes", "Broke"], "detail_options": ["Broke", "Made up"],
    }).json()
    assert made["detail_options"] == ["Broke"]
    assert _client(None).get("/api/v1/feedback-form").json()[-1]["detail_options"] == ["Broke"]
    edited = c.patch(f"/api/v1/admin/feedback/questions/{made['id']}", json={"options": ["Yes", "No"]}).json()
    assert edited["detail_options"] == []


def test_summary_lists_the_details_under_their_choice():
    rows = [{"created_at": "2026-10-02T09:00:00+00:00", "answers": [
        {"question_id": "a", "prompt": "Overall?", "kind": "rating", "value": 2},
        {"question_id": "w", "prompt": "Did it work?", "kind": "choice", "value": "Broke", "detail": "upload failed"},
    ]}]
    item = {i.question_id: i for i in feedback_summary.summarise(rows).items}["w"]
    assert item.counts == {"Broke": 1}
    assert [(t.text, t.about, t.score) for t in item.texts] == [("upload failed", "Broke", 2)]


def test_validate_answers_skips_an_optional_blank():
    stored = pf.validate_answers(Q, {a["question_id"]: a["value"] for a in GOOD} | {"q-more": "   "})
    assert [a["question_id"] for a in stored] == ["q-rate", "q-pick", "q-many", "q-nps", "q-next"]
    with pytest.raises(ValidationFailed):
        pf.validate_answers(Q, {})
