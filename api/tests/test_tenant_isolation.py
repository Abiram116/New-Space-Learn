"""Student B, signed in, against every one of student A's objects.

`test_guard_coverage.py` proves each handler *calls* an ownership check; this
proves the checks *hold*, end to end, on a database holding two accounts. B
sends every id-taking request in the API at A's ids — read, change, delete,
link, activate, grade, submit, upload — and afterwards:

- every one of A's rows is exactly as it was,
- nothing B wrote points at anything of A's,
- none of A's text ever appeared in a response to B, and
- no stored file of A's was touched.

The fake database applies the filters the routers really send (`eq.`, `in.`,
`or`, ranges), because a fake that ignored the `user_id` filter would make
every check here pass for the wrong reason.
"""

from __future__ import annotations

import copy
import re
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.errors import Unauthorized
from app.main import create_app
from app.services import ingest, supabase

A = "aaaaaaaa-0000-4000-8000-000000000001"
B = "bbbbbbbb-0000-4000-8000-000000000002"
SECRET = "A-PRIVATE"
STAMP = "2026-10-01T10:00:00+00:00"


def _matches(row: dict[str, Any], key: str, expr: str) -> bool:
    if key in ("or", "and"):
        parts = [p for p in expr.strip("()").split(",") if p]
        results = []
        for part in parts:
            col, op, value = part.split(".", 2)
            results.append(_matches(row, col, f"{op}.{value}"))
        return any(results) if key == "or" else all(results)
    op, _, value = expr.partition(".")
    have = row.get(key)
    if op == "eq":
        return str(have).lower() == value.lower()
    if op == "neq":
        return str(have).lower() != value.lower()
    if op == "in":
        return str(have) in value.strip("()").split(",")
    if op == "is":
        return have is None if value == "null" else str(have).lower() == value
    if op in ("lt", "lte", "gt", "gte"):
        if have is None:
            return False
        try:
            a, b = float(have), float(value)
        except (TypeError, ValueError):
            a, b = str(have), value  # ISO timestamps compare as text
        return {"lt": a < b, "lte": a <= b, "gt": a > b, "gte": a >= b}[op]
    raise AssertionError(f"fake database does not understand {key}={expr}")


class TwoTenantDb:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.storage_calls: list[tuple[str, Any]] = []
        self._n = 0

    def _id(self, table: str) -> str:
        self._n += 1
        return f"{table}-new-{self._n}"

    def _where(self, table: str, filters: dict[str, str] | None) -> list[dict[str, Any]]:
        rows = self.tables.setdefault(table, [])
        return [r for r in rows if all(_matches(r, k, v) for k, v in (filters or {}).items())]

    async def db_select(self, table, *, filters=None, select="*", order=None, limit=None):
        rows = [copy.deepcopy(r) for r in self._where(table, filters)]
        if table == "subspaces":
            for r in rows:
                subject = next((s for s in self.tables.get("subjects", []) if s["id"] == r.get("subject_id")), None)
                r["subjects"] = {"name": subject["name"]} if subject else None
        return rows[:limit] if limit else rows

    async def db_count(self, table, *, filters=None):
        return len(self._where(table, filters))

    async def db_insert(self, table, rows):
        out = []
        for row in rows if isinstance(rows, list) else [rows]:
            made = {"id": self._id(table), "created_at": STAMP, "updated_at": STAMP, **row}
            self.tables.setdefault(table, []).append(made)
            out.append(copy.deepcopy(made))
        return out

    async def db_update(self, table, *, filters, patch):
        hit = self._where(table, filters)
        for r in hit:
            r.update(copy.deepcopy(patch))
        return [copy.deepcopy(r) for r in hit]

    async def db_delete(self, table, *, filters):
        keep = set(map(id, self._where(table, filters)))
        self.tables[table] = [r for r in self.tables.get(table, []) if id(r) not in keep]

    async def db_rpc(self, fn, args, *, read_only=False):
        raise ConnectionError(f"no RPC {fn!r} in the fake")


def _seed(db: TwoTenantDb) -> None:
    t = db.tables
    t["subjects"] = [
        {"id": "space-a", "user_id": A, "name": f"{SECRET} subject", "tone": "brand", "pinned": False},
        {"id": "space-b", "user_id": B, "name": "B subject", "tone": "brand", "pinned": False},
    ]
    t["subspaces"] = [
        {"id": "sub-a", "user_id": A, "subject_id": "space-a", "name": f"{SECRET} topic", "memory_summary": SECRET},
        {"id": "sub-a2", "user_id": A, "subject_id": "space-a", "name": f"{SECRET} topic two"},
        {"id": "sub-b", "user_id": B, "subject_id": "space-b", "name": "B topic"},
    ]
    t["documents"] = [
        {"id": "doc-a", "user_id": A, "subspace_id": "sub-a", "name": f"{SECRET}.pdf", "mime_type": "application/pdf",
         "size_bytes": 10, "status": "ready", "storage_path": f"{A}/doc-a/secret.pdf", "created_at": STAMP},
    ]
    t["document_chunks"] = [
        {"id": "chunk-a", "user_id": A, "document_id": "doc-a", "subspace_id": "sub-a", "chunk_index": 0,
         "locator": "p. 1", "content": f"{SECRET} passage"},
    ]
    t["notes"] = [
        {"id": "note-a", "user_id": A, "subspace_id": "sub-a", "title": f"{SECRET} note", "body_md": SECRET,
         "origin": "user", "updated_at": STAMP},
    ]
    t["decks"] = [{"id": "deck-a", "user_id": A, "subspace_id": "sub-a", "name": f"{SECRET} deck"}]
    t["flashcards"] = [
        {"id": "card-a", "user_id": A, "deck_id": "deck-a", "front": f"{SECRET} front", "back": SECRET,
         "source": None, "ease": 2.5, "interval_days": 1, "reps": 0, "lapses": 0, "due_at": STAMP},
    ]
    t["quizzes"] = [
        {"id": "quiz-a", "user_id": A, "subspace_id": "sub-a", "topic": f"{SECRET} quiz", "created_at": STAMP,
         "questions": [{"q": f"{SECRET}?", "choices": ["x", "y"], "answer_index": 1}]},
    ]
    t["quiz_results"] = [{"id": "qr-a", "user_id": A, "quiz_id": "quiz-a", "score": 50, "answers": [0]}]
    t["skills"] = [
        {"id": "skill-a", "user_id": A, "is_library": False, "name": f"{SECRET} skill", "instructions": SECRET,
         "icon": "skill", "tone": "brand", "capabilities": [], "memory_scope": "session", "created_at": STAMP},
        {"id": "skill-lib", "user_id": None, "is_library": True, "name": "Library", "instructions": "Be kind.",
         "icon": "skill", "tone": "brand", "capabilities": [], "memory_scope": "session", "created_at": STAMP},
    ]
    t["subspace_skills"] = [{"subspace_id": "sub-a", "skill_id": "skill-a"}]
    t["subspace_links"] = [
        {"id": "link-a", "user_id": A, "subspace_id": "sub-a", "linked_subspace_id": "sub-a2"},
        {"id": "link-a2", "user_id": A, "subspace_id": "sub-a2", "linked_subspace_id": "sub-a"},
    ]
    t["chat_messages"] = [
        {"id": "msg-a", "user_id": A, "subspace_id": "sub-a", "role": "user", "content": SECRET, "created_at": STAMP},
    ]
    t["response_feedback"] = []
    t["card_reviews"] = []


@pytest.fixture
def world(monkeypatch):
    db = TwoTenantDb()
    _seed(db)
    for name in ("db_select", "db_count", "db_insert", "db_update", "db_delete", "db_rpc"):
        monkeypatch.setattr(supabase, name, getattr(db, name))

    async def storage_upload(path, data, *, content_type):
        db.storage_calls.append(("upload", path))
        return path

    async def storage_delete(path):
        db.storage_calls.append(("delete", path))

    async def storage_delete_many(paths):
        db.storage_calls.append(("delete_many", list(paths)))

    monkeypatch.setattr(supabase, "storage_upload", storage_upload)
    monkeypatch.setattr(supabase, "storage_delete", storage_delete)
    monkeypatch.setattr(supabase, "storage_delete_many", storage_delete_many)
    monkeypatch.setattr(ingest, "schedule", lambda *a, **k: None)

    async def verify(token):
        users = {"tok-a": A, "tok-b": B}
        if token not in users:
            raise Unauthorized("Sign in required.")
        return {"sub": users[token], "email": f"{token}@example.com", "exp": 9999999999}

    monkeypatch.setattr(supabase, "verify_access_token", verify)
    return db


def _a_rows(db: TwoTenantDb) -> dict[str, list[dict[str, Any]]]:
    """Everything that belongs to A, or hangs off one of A's objects."""
    a_ids = {r["id"] for rows in db.tables.values() for r in rows if r.get("user_id") == A}
    out: dict[str, list[dict[str, Any]]] = {}
    for table, rows in db.tables.items():
        mine = [r for r in rows if r.get("user_id") == A or (r.get("user_id") is None and r.get("subspace_id") in a_ids)]
        out[table] = sorted((copy.deepcopy(r) for r in mine), key=lambda r: str(r.get("id", r)))
    return out


#: (method, path, json body) — every route that takes an owned id, aimed at A's.
ATTACKS: list[tuple[str, str, dict | None]] = [
    ("GET", "/subspaces/sub-a/documents", None),
    ("POST", "/documents/doc-a/reprocess", None),
    ("DELETE", "/documents/doc-a", None),
    ("GET", "/documents/doc-a/passage?locator=p.%201", None),
    ("PATCH", "/subspaces/sub-a", {"name": "pwned"}),
    ("DELETE", "/subspaces/sub-a", None),
    ("GET", "/subspaces/sub-a/links", None),
    ("POST", "/subspaces/sub-a/links", {"linked_subspace_id": "sub-b"}),
    ("POST", "/subspaces/sub-b/links", {"linked_subspace_id": "sub-a"}),
    ("DELETE", "/subspaces/sub-a/links/sub-a2", None),
    ("DELETE", "/subspaces/sub-b/links/sub-a", None),
    ("POST", "/spaces/space-a/subspaces", {"name": "pwned"}),
    ("PATCH", "/spaces/space-a", {"name": "pwned"}),
    ("DELETE", "/spaces/space-a", None),
    ("GET", "/subspaces/sub-a/quizzes", None),
    ("GET", "/quizzes/quiz-a", None),
    ("POST", "/quizzes/quiz-a/submit", {"answers": [1]}),
    ("POST", "/subspaces/sub-a/quiz/generate", {"count": 3}),
    ("GET", "/subspaces/sub-a/notes", None),
    ("POST", "/subspaces/sub-a/notes", {"title": "pwned"}),
    ("POST", "/subspaces/sub-a/notes/generate", {}),
    ("POST", "/subspaces/sub-a/notes/ai-inline", {"prompt": "summarise"}),
    ("PATCH", "/notes/note-a", {"title": "pwned"}),
    ("DELETE", "/notes/note-a", None),
    ("GET", "/subspaces/sub-a/decks", None),
    ("POST", "/subspaces/sub-a/decks", {"name": "pwned"}),
    ("DELETE", "/decks/deck-a", None),
    ("GET", "/decks/deck-a/cards", None),
    ("POST", "/decks/deck-a/cards", {"front": "f", "back": "b"}),
    ("PATCH", "/cards/card-a", {"front": "pwned"}),
    ("DELETE", "/cards/card-a", None),
    ("POST", "/cards/card-a/grade", {"grade": "easy"}),
    ("POST", "/subspaces/sub-a/cards/generate", {}),
    ("GET", "/subspaces/sub-a/messages", None),
    ("POST", "/subspaces/sub-a/chat", {"text": "what is in here?"}),
    ("GET", "/subspaces/sub-a/skills", None),
    ("POST", "/subspaces/sub-a/skills/skill-lib", None),
    ("DELETE", "/subspaces/sub-a/skills/skill-a", None),
    ("POST", "/subspaces/sub-b/skills/skill-a", None),
    ("PATCH", "/skills/skill-a", {"name": "pwned"}),
    ("DELETE", "/skills/skill-a", None),
    ("POST", "/feedback", {"surface": "chat", "target_id": "msg-a", "subspace_id": "sub-a", "kind": "too_long"}),
    # The cross-topic lists: B's own, which must not include anything of A's.
    ("GET", "/notes", None),
    ("GET", "/quizzes", None),
    ("GET", "/decks", None),
    ("GET", "/skills", None),
]

#: Reading one specific object of A's is a 404 — never 403, which would
#: confirm the id exists.
MUST_BE_404 = {
    "/documents/doc-a/reprocess",
    "/documents/doc-a",
    "/documents/doc-a/passage?locator=p.%201",
    "/subspaces/sub-a",
    "/subspaces/sub-a/links",
    "/quizzes/quiz-a",
    "/quizzes/quiz-a/submit",
    "/notes/note-a",
    "/cards/card-a",
    "/cards/card-a/grade",
    "/subspaces/sub-a/chat",
    "/subspaces/sub-a/messages",
    "/subspaces/sub-b/skills/skill-a",
    "/skills/skill-a",
    "/feedback",
}


def test_student_b_cannot_read_or_change_anything_of_student_a(world):
    before = _a_rows(world)
    client = TestClient(create_app(), raise_server_exceptions=False)
    client.headers["Authorization"] = "Bearer tok-b"
    leaks, wrong = [], []
    for method, path, body in ATTACKS:
        r = client.request(method, f"/api/v1{path}", json=body)
        if SECRET in r.text:
            leaks.append(f"{method} {path}")
        if r.status_code >= 500:
            wrong.append(f"{method} {path} → {r.status_code}")
        # A delete scoped to the caller may answer 200 for a no-op; anything
        # else aimed at one of A's objects must be a plain 404.
        quiet_delete = method == "DELETE" and r.status_code == 200
        if path in MUST_BE_404 and not quiet_delete and r.status_code != 404:
            wrong.append(f"{method} {path} → {r.status_code}, expected 404")
    upload = client.post(
        "/api/v1/subspaces/sub-a/documents", files={"file": ("x.txt", b"hello", "text/plain")}
    )
    if upload.status_code != 404:
        wrong.append(f"upload into A's topic → {upload.status_code}")

    assert not leaks, "A's data reached B:\n  " + "\n  ".join(leaks)
    assert not wrong, "\n  ".join(wrong)
    assert _a_rows(world) == before, "one of A's rows changed"

    # Nothing B wrote points at anything of A's.
    a_ids = {r["id"] for rows in before.values() for r in rows if "id" in r}
    for table, rows in world.tables.items():
        for r in rows:
            if r.get("user_id") == B or (table == "subspace_skills" and r.get("subspace_id") == "sub-b"):
                pointing = {k: v for k, v in r.items() if k != "id" and isinstance(v, str) and v in a_ids}
                assert not pointing, f"B's {table} row points at A's {pointing}"
    assert not [c for c in world.storage_calls if A in str(c)], world.storage_calls


def test_a_planted_activation_row_never_reads_back_another_accounts_private_skill(world):
    """Defence in depth for `subspace_skills`: a row naming A's private skill in
    B's own topic (written straight to the database, around the API's checks)
    still reads back nothing of A's — on the skills list and in chat's own read."""
    world.tables["subspace_skills"].append({"subspace_id": "sub-b", "skill_id": "skill-a"})
    world.tables["subspace_skills"].append({"subspace_id": "sub-b", "skill_id": "skill-lib"})
    client = TestClient(create_app())
    client.headers["Authorization"] = "Bearer tok-b"
    r = client.get("/api/v1/subspaces/sub-b/skills")
    assert r.status_code == 200
    assert [s["id"] for s in r.json()] == ["skill-lib"]
    assert SECRET not in r.text

    import asyncio

    from app.routers import subspace_chat

    skills = asyncio.run(subspace_chat._read_active_skills(B, "sub-b"))
    assert [s["id"] for s in skills] == ["skill-lib"]


def test_the_owner_still_reaches_their_own_objects(world):
    """The same requests as A succeed — so the sweep above is refusing B, not
    simply broken."""
    client = TestClient(create_app())
    client.headers["Authorization"] = "Bearer tok-a"
    assert client.get("/api/v1/quizzes/quiz-a").status_code == 200
    assert client.get("/api/v1/subspaces/sub-a/notes").json()[0]["id"] == "note-a"
    assert client.get("/api/v1/decks/deck-a/cards").json()[0]["id"] == "card-a"
    assert [s["id"] for s in client.get("/api/v1/subspaces/sub-a/skills").json()] == ["skill-a"]
    assert client.get("/api/v1/documents/doc-a/passage", params={"locator": "p. 1"}).status_code == 200


def test_the_sweep_covers_every_owned_id_route():
    """A new id-taking route that is not in ATTACKS fails here, so the sweep
    grows with the API instead of quietly going stale."""
    from .test_guard_coverage import _routes_with_owned_ids

    attacked = {re.sub(r"\?.*", "", p) for _, p, _ in ATTACKS} | {"/subspaces/sub-a/documents"}

    def shape(path: str) -> str:
        return re.sub(r"\{[^}]+\}", "*", path.removeprefix("/api/v1"))

    attacked_shapes = {re.sub(r"(sub|space|doc|note|deck|card|quiz|skill)-[a-z0-9]+", "*", p) for p in attacked}
    missing = sorted({shape(p) for p, _, _ in _routes_with_owned_ids()} - attacked_shapes)
    assert not missing, f"add these routes to ATTACKS: {missing}"
