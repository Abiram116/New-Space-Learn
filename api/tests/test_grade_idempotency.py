"""A card grade re-sent by the client is applied once.

The browser retries a grade whose reply it never got. Without this the retry
moved the card's schedule a second time for one answer."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.deps import CurrentUser, get_current_user
from app.main import create_app
from app.routers import flashcards

from .conftest import OWNER

CARD = {
    "id": "card-1", "user_id": OWNER, "deck_id": "deck-1", "front": "q", "back": "a", "source": None,
    "ease": 2.5, "interval_days": 0, "reps": 0, "lapses": 0, "due_at": "2026-10-01T00:00:00+00:00",
    "stability": None, "difficulty": None, "last_review_at": None,
}


@pytest.fixture
def client(db):
    db.seed("flashcards", [dict(CARD)])
    db.seed("decks", [{"id": "deck-1", "user_id": OWNER, "subspace_id": "sub-1"}])
    flashcards._graded = flashcards.locks.Recent()
    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=OWNER, email="o@x.test")
    c = TestClient(app)
    c.db = db  # type: ignore[attr-defined]
    return c


def _card_updates(client):
    return [u for u in client.db.updates if u["table"] == "flashcards"]


def _reviews(client):
    return [i for i in client.db.inserts if i["table"] == "card_reviews"]


def test_the_same_review_id_is_applied_once(client):
    body = {"grade": "good", "review_id": "abc12345-retry"}
    first = client.post("/api/v1/cards/card-1/grade", json=body)
    again = client.post("/api/v1/cards/card-1/grade", json=body)
    assert first.status_code == again.status_code == 200
    assert first.json() == again.json()
    assert len(_card_updates(client)) == 1
    assert len(_reviews(client)) == 1


def test_a_new_review_id_is_a_new_grade(client):
    client.post("/api/v1/cards/card-1/grade", json={"grade": "good", "review_id": "first-review-1"})
    client.post("/api/v1/cards/card-1/grade", json={"grade": "good", "review_id": "second-review-2"})
    assert len(_card_updates(client)) == 2


def test_without_an_id_it_behaves_as_before(client):
    r1 = client.post("/api/v1/cards/card-1/grade", json={"grade": "again"})
    r2 = client.post("/api/v1/cards/card-1/grade", json={"grade": "again"})
    assert r1.status_code == r2.status_code == 200
    assert len(_card_updates(client)) == 2


def test_another_users_id_cannot_replay_someone_elses_result(client):
    client.post("/api/v1/cards/card-1/grade", json={"grade": "good", "review_id": "shared-id-0001"})
    # The key includes the user: a different account never matches it.
    assert all(key.startswith(f"{OWNER}:") for key in flashcards._graded._items)


def test_a_malformed_review_id_is_rejected(client):
    r = client.post("/api/v1/cards/card-1/grade", json={"grade": "good", "review_id": "bad id!"})
    assert r.status_code == 422
