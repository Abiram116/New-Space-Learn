"""Global search: the escaping helper, the snippets, and the endpoint.

The fake database ignores `ilike` / `or` filters (it only applies `eq.`), so
every row seeded for a user reaches the router — which is exactly what lets
these tests prove the router's own literal re-check, the part that turns the
deliberately loose database filter back into an exact match.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.deps import CurrentUser, get_current_user
from app.errors import UpstreamUnavailable
from app.main import create_app
from app.routers import search as search_router
from app.routers.search import clean_query, ilike_value, or_ilike, plain_text, snippet

from .conftest import INTRUDER, OWNER

SUBJECT = "5ub00000-0000-0000-0000-000000000001"
TOPIC = "70p00000-0000-0000-0000-000000000001"
DECK = "dec00000-0000-0000-0000-000000000001"


def _user(user_id: str = OWNER) -> CurrentUser:
    return CurrentUser(id=user_id, email=None)


async def _search(q: str, user_id: str = OWNER, limit: int = 5):
    return await search_router.search(q=q, limit=limit, user=_user(user_id))


def _seed(db) -> None:
    db.seed("subjects", [{"id": SUBJECT, "user_id": OWNER, "name": "Operating Systems"}])
    db.seed(
        "subspaces",
        [{"id": TOPIC, "user_id": OWNER, "subject_id": SUBJECT, "name": "Deadlock"}],
    )
    db.seed(
        "notes",
        [
            {
                "id": "note-1",
                "user_id": OWNER,
                "subspace_id": TOPIC,
                "title": "Coffman conditions",
                "body_md": "<p>The <strong>four</strong> conditions: mutual exclusion, "
                "hold &amp; wait, no preemption and circular wait.</p>",
            },
            {
                "id": "note-2",
                "user_id": OWNER,
                "subspace_id": TOPIC,
                "title": "Banker's algorithm",
                "body_md": "## Safe state\n\n"
                + ("filler " * 400)
                + "**avoids deadlock** by checking.",
            },
            # Matches only inside markup: must not be reported.
            {
                "id": "note-3",
                "user_id": OWNER,
                "subspace_id": TOPIC,
                "title": "Layout",
                "body_md": '<span class="mutual">plain words</span>',
            },
            # Someone else's note with the same words: never returned.
            {
                "id": "note-x",
                "user_id": INTRUDER,
                "subspace_id": TOPIC,
                "title": "Mutual exclusion",
                "body_md": "",
            },
        ],
    )
    db.seed(
        "decks", [{"id": DECK, "user_id": OWNER, "subspace_id": TOPIC, "name": "Deadlock basics"}]
    )
    db.seed(
        "flashcards",
        [
            {
                "id": "card-1",
                "user_id": OWNER,
                "deck_id": DECK,
                "front": "What is mutual exclusion?",
                "back": "Only one process may hold the resource.",
                "decks": {"id": DECK, "name": "Deadlock basics", "subspace_id": TOPIC},
            },
            # Its deck is gone (deleted mid-search): nowhere to open, dropped.
            {
                "id": "card-orphan",
                "user_id": OWNER,
                "deck_id": "gone",
                "front": "mutual",
                "back": "",
                "decks": None,
            },
        ],
    )
    db.seed(
        "quizzes",
        [
            {
                "id": "quiz-1",
                "user_id": OWNER,
                "subspace_id": TOPIC,
                "topic": "Deadlock prevention",
                "q0": "Which condition does lock ordering break?",
                "q1": "Is mutual exclusion always required?",
            },
            {
                "id": "quiz-2",
                "user_id": OWNER,
                "subspace_id": TOPIC,
                "topic": "Paging",
                "q0": "What is a TLB?",
            },
        ],
    )
    db.seed(
        "documents",
        [
            {
                "id": "doc-1",
                "user_id": OWNER,
                "subspace_id": TOPIC,
                "name": "lecture-5 (mutual).pdf",
                "status": "ready",
            }
        ],
    )
    db.seed(
        "document_chunks",
        [
            {
                "id": "chunk-1",
                "user_id": OWNER,
                "subspace_id": TOPIC,
                "document_id": "doc-1",
                "content": "Mutual exclusion is the first Coffman condition.",
                "locator": "p. 4",
                "documents": {"name": "lecture-5 (mutual).pdf"},
            }
        ],
    )


def _kinds(out) -> dict[str, list]:
    return {g.kind: g.hits for g in out.groups}


# ── The escaping helper ────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("deadlock", "*deadlock*"),
        ("50%", "*50_*"),
        ("snake_case", "*snake_case*"),
        ("a*b", "*a_b*"),
        ("C:\\path", "*C:_path*"),
        ("f(x), g(y)", "*f_x__ g_y_*"),
        ('say "hi"', "*say _hi_*"),
        ("e.g. café", "*e.g. café*"),
    ],
)
def test_ilike_value_neutralises_every_special_character(raw, expected):
    assert ilike_value(raw) == expected


def test_or_ilike_quotes_each_column_and_cannot_be_broken_out_of():
    out = or_ilike(["title", "body_md"], 'x"),user_id.neq.(')
    assert out == '(title.ilike."*x___user_id.neq._*",body_md.ilike."*x___user_id.neq._*")'
    # Exactly the structure we wrote: two quoted values, no stray syntax.
    assert out.count('"') == 4
    assert out.count("(") == 1 and out.count(")") == 1


def test_clean_query_normalises_and_caps():
    assert clean_query("  dead\x00lock \n\t ") == "dead lock"
    # A decomposed é (e + combining accent) becomes the composed one.
    assert clean_query("cafe\u0301") == "café"
    assert len(clean_query("x" * 5000)) == search_router.MAX_QUERY
    assert clean_query(None) == ""


# ── Snippets ────────────────────────────────────────────────────────────


def test_plain_text_strips_html_and_markdown():
    text = plain_text(
        "<details><summary>Hi</summary>**bold** and [a link](http://x) &amp; `code`</details>"
    )
    assert text == "Hi bold and a link & code"


def test_snippet_centres_on_the_match_and_marks_cuts():
    body = ("alpha " * 100) + "the needle is here " + ("omega " * 100)
    out = snippet(body, "needle")
    assert "needle" in out
    assert out.startswith("…") and out.endswith("…")
    assert len(out) <= search_router._SNIPPET_CHARS + 2


def test_snippet_short_text_is_whole():
    assert snippet("short", "sho") == "short"
    assert snippet("", "x") is None


# ── The endpoint ───────────────────────────────────────────────────────


async def test_finds_every_kind_with_where_to_open_it(db):
    _seed(db)
    out = await _search("mutual")
    kinds = _kinds(out)

    assert [h.id for h in kinds["note"]] == ["note-1"]
    note = kinds["note"][0]
    assert note.subject_id == SUBJECT and note.subject_name == "Operating Systems"
    assert note.subspace_id == TOPIC and note.subspace_name == "Deadlock"
    assert "<" not in note.snippet and "mutual exclusion" in note.snippet

    card = kinds["card"][0]
    assert card.id == "card-1" and card.deck_id == DECK and card.deck_name == "Deadlock basics"

    quiz = kinds["quiz"][0]
    assert quiz.id == "quiz-1" and "mutual exclusion" in quiz.snippet
    assert [h.id for h in kinds["file"]] == ["doc-1"]
    passage = kinds["passage"][0]
    assert passage.document_id == "doc-1" and passage.locator == "p. 4"
    assert out.partial is False


async def test_never_returns_another_users_rows(db):
    _seed(db)
    out = await _search("mutual")
    ids = {h.id for g in out.groups for h in g.hits}
    assert "note-x" not in ids
    # Every read was scoped to the caller.
    assert all(s["filters"].get("user_id") == f"eq.{OWNER}" for s in db.selects)


async def test_drops_matches_only_in_markup_and_orphans(db):
    _seed(db)
    ids = {h.id for g in (await _search("mutual")).groups for h in g.hits}
    assert "note-3" not in ids  # matched only `class="mutual"`
    assert "card-orphan" not in ids


async def test_topics_and_subjects_match_by_name(db):
    _seed(db)
    kinds = _kinds(await _search("dead"))
    assert kinds["topic"][0].id == TOPIC
    # The body-only match ranks after nothing else here, but is found in a long note.
    assert "note-2" in [h.id for h in kinds["note"]]
    assert "deadlock" in kinds["note"][0].snippet.lower()
    assert _kinds(await _search("operating"))["subject"][0].subject_id == SUBJECT


async def test_title_matches_rank_above_body_matches(db):
    _seed(db)
    db.rows["notes"].append(
        {
            "id": "note-4",
            "user_id": OWNER,
            "subspace_id": TOPIC,
            "title": "Deadlock detection",
            "body_md": "",
        }
    )
    notes = _kinds(await _search("deadlock"))["note"]
    assert notes[0].id == "note-4"


async def test_literal_special_characters_match_only_themselves(db):
    _seed(db)
    db.rows["notes"] += [
        {
            "id": "pct",
            "user_id": OWNER,
            "subspace_id": TOPIC,
            "title": "Scored 50% on it",
            "body_md": "",
        },
        {
            "id": "num",
            "user_id": OWNER,
            "subspace_id": TOPIC,
            "title": "Scored 500 on it",
            "body_md": "",
        },
    ]
    ids = [h.id for h in _kinds(await _search("50%"))["note"]]
    assert ids == ["pct"]


@pytest.mark.parametrize("q", ["", " ", "a", "\x00", "%"])
async def test_too_short_returns_nothing_without_querying(db, q):
    out = await _search(q)
    assert out.groups == []
    assert db.selects == []


@pytest.mark.parametrize(
    "q", ["%%", "__", "()", '"",', "\\\\", "*)(*", "😀😀", "日本語", "x" * 1000]
)
async def test_odd_input_never_errors(db, q):
    _seed(db)
    out = await _search(q)
    assert out.partial is False


async def test_unicode_case_insensitive(db):
    _seed(db)
    db.rows["notes"].append(
        {
            "id": "u",
            "user_id": OWNER,
            "subspace_id": TOPIC,
            "title": "Ελληνικά ΣΗΜΕΙΩΣΕΙΣ",
            "body_md": "Café crème",
        }
    )
    assert [h.id for h in _kinds(await _search("σημειώσεις".replace("ώ", "ω")))["note"]] == ["u"]
    assert [h.id for h in _kinds(await _search("CAFÉ"))["note"]] == ["u"]


async def test_per_kind_limit_is_clamped(db):
    _seed(db)
    db.rows["notes"] = [
        {
            "id": f"n{i}",
            "user_id": OWNER,
            "subspace_id": TOPIC,
            "title": f"mutual {i}",
            "body_md": "",
        }
        for i in range(40)
    ]
    assert len(_kinds(await _search("mutual", limit=3))["note"]) == 3
    assert len(_kinds(await _search("mutual", limit=999))["note"]) == search_router.MAX_PER_KIND
    assert len(_kinds(await _search("mutual", limit=-4))["note"]) == 1


async def test_one_failing_kind_still_returns_the_rest(db, monkeypatch):
    _seed(db)
    real = db.db_select

    async def flaky(table, **kw):
        if table == "document_chunks":
            raise TimeoutError
        return await real(table, **kw)

    from app.services import supabase as supabase_module

    monkeypatch.setattr(supabase_module, "db_select", flaky)
    out = await _search("mutual")
    assert out.partial is True
    assert "passage" not in _kinds(out) and "note" in _kinds(out)


async def test_everything_failing_is_a_503_not_a_500(db, monkeypatch):
    async def down(table, **kw):
        raise ConnectionError("db down")

    from app.services import supabase as supabase_module

    monkeypatch.setattr(supabase_module, "db_select", down)
    with pytest.raises(UpstreamUnavailable):
        await _search("mutual")


async def test_quiz_scan_projects_only_question_text(db):
    _seed(db)
    await _search("mutual")
    quiz_read = next(s for s in db.selects if s["table"] == "quizzes")
    assert "questions->0->>q" in quiz_read["select"]
    assert "source_chunk" not in quiz_read["select"]


# ── Over HTTP ──────────────────────────────────────────────────────────


def test_signed_out_is_401():
    r = TestClient(create_app()).get("/api/v1/search", params={"q": "mutual"})
    assert r.status_code == 401


def test_http_round_trip(db):
    _seed(db)
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: _user()
    r = TestClient(app).get("/api/v1/search", params={"q": "mutual", "limit": "abc"})
    assert r.status_code == 422  # a non-number limit is a validation error, not a crash
    r = TestClient(app).get("/api/v1/search", params={"q": "mutual (lecture)"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"query", "groups", "partial"}
    r = TestClient(app).get("/api/v1/search", params={"q": "mutual"})
    first = r.json()["groups"][0]
    assert {"kind", "label", "hits"} <= set(first)
