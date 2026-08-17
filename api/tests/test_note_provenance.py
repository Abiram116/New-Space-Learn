"""Every code path that can change a Note's content, traced end to end
against `touched_by_user` / `touched_by_agent` — not just the pure
`provenanceLabel` formatting the frontend already covers.

`origin` only ever records who created a note. These two booleans track who
has actually touched its content since, independently — an AI-created note a
student later edits by hand must count in both the AI and Mine filters, and
that has to hold no matter which of the app's several ways to write into a
note produced the change.
"""

from __future__ import annotations

import pytest

from app.deps import CurrentUser
from app.routers import notes as notes_router
from app.schemas import NoteCreate, NoteGenerate, NoteUpdate

from .conftest import INTRUDER, OWNER

SUBSPACE_ID = "aaaaaaaa-0000-0000-0000-00000000n0te"
NOTE_ID = "bbbbbbbb-0000-0000-0000-00000000n0te"


def _user() -> CurrentUser:
    return CurrentUser(id=OWNER, email="student@example.com")


def _seed_subspace(db) -> None:
    db.seed(
        "subspaces",
        [{"id": SUBSPACE_ID, "user_id": OWNER, "subject_id": "s1", "name": "Attention"}],
    )


def _persist(db, note) -> None:
    """`FakeDb.db_update` (see conftest.py) records the call and returns a
    merged copy, but never mutates its own row store — enough for the
    single-step "what patch was sent" tests elsewhere in this suite, but a
    flow test that creates a note and then edits it more than once needs
    each step to actually be visible to the next, the way a real UPDATE
    would leave it. This does that persistence by hand, in between calls to
    the real endpoint — the endpoint's own logic still runs for real on
    every step; only the "did it stick" bookkeeping is manual."""
    rows = db.rows.setdefault("notes", [])
    data = {"user_id": OWNER, **note.model_dump(mode="json")}
    for i, row in enumerate(rows):
        if row["id"] == note.id:
            rows[i] = {**row, **data}
            return
    rows.append(data)


# ── 1. User creates a note by hand ──────────────────────────────────────


async def test_manual_creation_is_touched_by_user_only(db):
    _seed_subspace(db)
    created = await notes_router.create_note(
        SUBSPACE_ID, NoteCreate(title="My note", body_md="", origin="user"), _user()
    )
    assert created.touched_by_user is True
    assert created.touched_by_agent is False


# ── 2. AI creates a note ("Write with AI" / "Add to note" → new) ───────


async def test_agent_creation_is_touched_by_agent_only(db):
    """Covers both `generate_note`'s own hardcoded insert AND the
    `AddToNote.tsx` "new note" path, which now passes `origin='agent'`
    through this same `create_note` endpoint — one insert shape, two
    callers, both need this to hold."""
    _seed_subspace(db)
    created = await notes_router.create_note(
        SUBSPACE_ID, NoteCreate(title="AI note", body_md="Written by AI.", origin="agent"), _user()
    )
    assert created.touched_by_user is False
    assert created.touched_by_agent is True


class _FakeLLM:
    """Yields the `TITLE: ... \\n---\\n<body>` shape `generate_note` parses."""

    async def stream_chat(self, messages, *, model=None, temperature=0.4):
        yield "TITLE: Self-attention\n"
        yield "---\n"
        yield "Self-attention lets tokens weigh each other."


async def test_generate_note_endpoint_marks_agent_creation(db, monkeypatch):
    """The real `/subspaces/{id}/notes/generate` handler, not just the shape
    of the insert dict — proves the endpoint itself, including its prompt
    plumbing, actually reaches the code that sets these flags."""
    _seed_subspace(db)
    monkeypatch.setattr(notes_router, "get_llm", lambda: _FakeLLM())
    monkeypatch.setattr(notes_router.settings, "groq_api_key", "test-key")
    monkeypatch.setattr(
        notes_router.rag, "retrieve", lambda *a, **k: _async_list([_Retrieved()])
    )
    monkeypatch.setattr(
        notes_router, "recent_history", lambda *a, **k: _async_list([])
    )
    monkeypatch.setattr(
        notes_router.personalization, "build", lambda *a, **k: _async_value("")
    )

    created = await notes_router.generate_note(
        SUBSPACE_ID, NoteGenerate(topic="Attention"), _user()
    )
    assert created.origin == "agent"
    assert created.touched_by_user is False
    assert created.touched_by_agent is True


class _Retrieved:
    content = "Attention lets a model weigh tokens against each other."


async def _async_list(items):
    return items


async def _async_value(v):
    return v


# ── 3. Normal manual editing / autosave ─────────────────────────────────


async def test_ordinary_autosave_marks_touched_by_user_only(db):
    """The editor's plain debounced save — no `ai_touched` flag — must
    never flip `touched_by_agent`, even on a note the AI originally wrote."""
    db.seed(
        "notes",
        [
            {
                "id": NOTE_ID,
                "user_id": OWNER,
                "title": "AI note",
                "body_md": "old",
                "origin": "agent",
                "touched_by_user": False,
                "touched_by_agent": True,
            }
        ],
    )
    updated = await notes_router.update_note(
        NOTE_ID, NoteUpdate(body_md="old + what I typed"), _user()
    )
    assert updated.touched_by_user is True
    assert updated.touched_by_agent is True  # already true from creation — untouched, not cleared


async def test_title_only_edit_also_counts_as_touched_by_user(db):
    db.seed(
        "notes",
        [
            {
                "id": NOTE_ID,
                "user_id": OWNER,
                "title": "old title",
                "body_md": "",
                "origin": "user",
                "touched_by_user": True,
                "touched_by_agent": False,
            }
        ],
    )
    updated = await notes_router.update_note(NOTE_ID, NoteUpdate(title="new title"), _user())
    assert updated.touched_by_user is True
    assert updated.touched_by_agent is False


# ── 4. Inline AI commands (`/ai <prompt>` accepted into the note) ──────


async def test_ai_touched_save_marks_both_flags(db):
    """The one PATCH the editor sends right after accepting an `/ai`
    suggestion (see `NoteEditor.tsx`'s `aiTouchedRef`) or an "Add to note"
    append (`AddToNote.tsx`). A human chose to accept AI content into their
    own note, so both flags become true — this is exactly what makes a note
    genuinely collaborative rather than purely one party's."""
    db.seed(
        "notes",
        [
            {
                "id": NOTE_ID,
                "user_id": OWNER,
                "title": "My note",
                "body_md": "what I wrote",
                "origin": "user",
                "touched_by_user": True,
                "touched_by_agent": False,
            }
        ],
    )
    updated = await notes_router.update_note(
        NOTE_ID,
        NoteUpdate(body_md="what I wrote\n\nwhat the AI added", ai_touched=True),
        _user(),
    )
    assert updated.touched_by_user is True
    assert updated.touched_by_agent is True


async def test_ai_touched_alone_with_no_content_change_is_not_silently_dropped(db):
    """Regression: `patch` excludes `ai_touched` before the "anything to do?"
    check — a call carrying only `ai_touched=True` used to look like an empty
    patch and return early with the flag never written anywhere."""
    db.seed(
        "notes",
        [
            {
                "id": NOTE_ID,
                "user_id": OWNER,
                "title": "My note",
                "body_md": "x",
                "origin": "user",
                "touched_by_user": True,
                "touched_by_agent": False,
            }
        ],
    )
    updated = await notes_router.update_note(NOTE_ID, NoteUpdate(ai_touched=True), _user())
    assert updated.touched_by_agent is True


# ── The four flows the audit asked to be pinned end to end ─────────────


async def test_flow_user_creates_reads_back_as_created_by_you(db):
    _seed_subspace(db)
    created = await notes_router.create_note(
        SUBSPACE_ID, NoteCreate(title="x", body_md="", origin="user"), _user()
    )
    _persist(db, created)
    reloaded = await notes_router.update_note(created.id, NoteUpdate(), _user())
    assert reloaded.origin == "user"
    assert reloaded.touched_by_user is True
    assert reloaded.touched_by_agent is False  # → "Created by you"


async def test_flow_ai_creates_reads_back_as_created_by_ai(db):
    _seed_subspace(db)
    created = await notes_router.create_note(
        SUBSPACE_ID, NoteCreate(title="x", body_md="", origin="agent"), _user()
    )
    _persist(db, created)
    reloaded = await notes_router.update_note(created.id, NoteUpdate(), _user())
    assert reloaded.origin == "agent"
    assert reloaded.touched_by_agent is True
    assert reloaded.touched_by_user is False  # → "Created by AI"


async def test_flow_ai_creates_then_user_edits_normally(db):
    _seed_subspace(db)
    created = await notes_router.create_note(
        SUBSPACE_ID, NoteCreate(title="x", body_md="", origin="agent"), _user()
    )
    _persist(db, created)
    edited = await notes_router.update_note(created.id, NoteUpdate(body_md="typed by hand"), _user())
    _persist(db, edited)
    reloaded = await notes_router.update_note(created.id, NoteUpdate(), _user())
    assert reloaded.origin == "agent"
    assert reloaded.touched_by_agent is True
    assert reloaded.touched_by_user is True  # → "Created by AI · Edited by you"


async def test_flow_user_creates_then_ai_edits(db):
    _seed_subspace(db)
    created = await notes_router.create_note(
        SUBSPACE_ID, NoteCreate(title="x", body_md="", origin="user"), _user()
    )
    _persist(db, created)
    edited = await notes_router.update_note(
        created.id, NoteUpdate(body_md="my text\n\nai text", ai_touched=True), _user()
    )
    _persist(db, edited)
    reloaded = await notes_router.update_note(created.id, NoteUpdate(), _user())
    assert reloaded.origin == "user"
    assert reloaded.touched_by_user is True
    assert reloaded.touched_by_agent is True  # → "Created by you · Edited by AI"


async def test_flow_repeated_back_and_forth_stays_at_the_same_two_flags(db):
    """"Both edit repeatedly" has nowhere further to go with a two-boolean
    model, and that's by design, not a gap: there is no edit count to
    summarise, so a third "Collaborative" tier would carry no information
    "Created by AI · Edited by you" doesn't already — see `format.ts`'s
    `provenanceLabel` docstring on the frontend for the same reasoning."""
    _seed_subspace(db)
    created = await notes_router.create_note(
        SUBSPACE_ID, NoteCreate(title="x", body_md="", origin="agent"), _user()
    )
    _persist(db, created)
    for patch in [
        NoteUpdate(body_md="1"),
        NoteUpdate(body_md="1+2", ai_touched=True),
        NoteUpdate(body_md="1+2+3"),
    ]:
        step = await notes_router.update_note(created.id, patch, _user())
        _persist(db, step)
    reloaded = await notes_router.update_note(
        created.id, NoteUpdate(body_md="1+2+3+4", ai_touched=True), _user()
    )
    assert reloaded.touched_by_user is True
    assert reloaded.touched_by_agent is True


# ── Ownership: a PATCH must not touch another user's note ──────────────


async def test_update_note_cannot_touch_another_users_note(db):
    db.seed(
        "notes",
        [{"id": NOTE_ID, "user_id": OWNER, "title": "x", "body_md": "", "origin": "user"}],
    )
    from app.errors import NotFound

    with pytest.raises(NotFound):
        await notes_router.update_note(
            NOTE_ID, NoteUpdate(body_md="hijacked"), CurrentUser(id=INTRUDER, email=None)
        )
