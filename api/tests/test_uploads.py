"""Uploads and request size: what the server will accept, checked through the
real app (TestClient), because the failures were all at the HTTP edge."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.deps import CurrentUser, get_current_user
from app.errors import ValidationFailed
from app.main import create_app
from app.middleware import MAX_BODY_BYTES, MAX_UPLOAD_BYTES
from app.services import ingest, ratelimit, supabase, uploads

from .conftest import OWNER

SUBSPACE = "33333333-3333-3333-3333-333333333333"


@pytest.fixture
def client(db, monkeypatch):
    db.seed("subspaces", [{"id": SUBSPACE, "user_id": OWNER, "subject_id": "s", "name": "T"}])
    stored: list[tuple[str, int, str]] = []

    async def storage_upload(path, data, *, content_type):
        stored.append((path, len(data), content_type))
        return path

    # The shared fake does not remember inserts; an upload inserts a row and
    # then updates it, so this one does.
    async def db_insert(table, rows):
        payload = rows if isinstance(rows, list) else [rows]
        made = [{"id": f"doc-{len(db.rows.get(table, [])) + i}", "created_at": "2026-10-02T00:00:00Z", **r}
                for i, r in enumerate(payload)]
        db.rows.setdefault(table, []).extend(made)
        return made

    monkeypatch.setattr(supabase, "db_insert", db_insert)

    scheduled: list[dict] = []
    monkeypatch.setattr(supabase, "storage_upload", storage_upload)
    monkeypatch.setattr(ingest, "schedule", lambda doc, data=None, **_: scheduled.append(doc))
    monkeypatch.setattr(ingest, "progress", lambda _id: None)
    monkeypatch.setattr(ingest, "is_running", lambda _id: False)
    ratelimit.reset()

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=OWNER, email="o@x.test")
    c = TestClient(app)
    c.stored = stored  # type: ignore[attr-defined]
    c.db = db  # type: ignore[attr-defined]
    return c


def _upload(client, name, data=b"hello", content_type="text/plain"):
    return client.post(
        f"/api/v1/subspaces/{SUBSPACE}/documents", files={"file": (name, data, content_type)}
    )


# ── What may be uploaded ───────────────────────────────────────────────


def test_a_normal_upload_is_stored_under_a_safe_name(client):
    r = _upload(client, "Lecture 3 — Résumé #2?.pdf", b"%PDF-1.4 x", "application/octet-stream")
    assert r.status_code == 201, r.text
    path, size, content_type = client.stored[0]
    assert path.startswith(f"{OWNER}/") and path.endswith("/Lecture-3-Resume-2.pdf")
    assert size == 10
    # Read as a PDF because of its extension, not as whatever the browser called it.
    assert content_type == "application/pdf"
    # The student still sees their own file name.
    assert r.json()["name"] == "Lecture 3 — Résumé #2?.pdf"


@pytest.mark.parametrize("name", ["run.exe", "page.html", "archive.zip", "script.js", "noextension"])
def test_unsupported_types_are_refused_before_anything_is_stored(client, name):
    r = _upload(client, name, b"MZ\x90", "application/octet-stream")
    assert r.status_code == 422
    assert "isn't supported" in r.json()["error"]["message"]
    assert client.stored == []


def test_a_path_in_the_filename_cannot_escape_the_users_folder(client):
    r = _upload(client, "../../other-user/secret.txt")
    assert r.status_code == 201
    path = client.stored[0][0]
    assert ".." not in path and path.count("/") == 2
    assert path.endswith("/secret.txt")
    assert r.json()["name"] == "secret.txt"


def test_storage_name_is_always_plain_ascii():
    assert uploads.storage_name("नोट्स.pdf") == "file.pdf"
    assert uploads.storage_name("a b/c\\d.TXT") == "d.txt"
    assert uploads.storage_name("x" * 300 + ".md").endswith(".md")
    assert len(uploads.storage_name("x" * 300 + ".md")) <= 84
    assert uploads.storage_name("....") == "file"
    assert uploads.display_name("y" * 300 + ".pdf").endswith(".pdf")
    assert len(uploads.display_name("y" * 300 + ".pdf")) == 200


def test_a_file_over_20mb_is_refused(client):
    r = _upload(client, "big.txt", b"a" * (uploads.MAX_BYTES + 1))
    assert r.status_code in (413, 422)
    assert client.stored == []


async def test_read_capped_stops_instead_of_reading_everything():
    class Endless:
        read_calls = 0

        async def read(self, n):
            self.read_calls += 1
            return b"x" * n

    f = Endless()
    with pytest.raises(ValidationFailed):
        await uploads.read_capped(f, limit=3 * 1024 * 1024)  # type: ignore[arg-type]
    assert f.read_calls <= 4  # stopped as soon as it ran over


def test_every_upload_is_metered_and_images_cost_more(client):
    assert _upload(client, "a.txt").status_code == 201
    ratelimit.reset()
    fits = int(ratelimit.CAPACITY // 2)  # an image costs 2 of the bucket
    codes = [_upload(client, f"{i}.png", b"\x89PNG", "image/png").status_code for i in range(fits + 2)]
    assert codes[:fits] == [201] * fits
    assert codes[fits] == 429


def test_reprocessing_is_metered_too(client):
    client.db.seed(
        "documents",
        [{"id": "d1", "user_id": OWNER, "name": "scan.png", "mime_type": "image/png",
          "status": "ready", "storage_path": "p", "created_at": "2026-10-01T00:00:00Z"}],
    )
    ratelimit.reset()
    fits = int(ratelimit.CAPACITY // 2)
    codes = [client.post("/api/v1/documents/d1/reprocess").status_code for _ in range(fits + 1)]
    assert codes[:fits] == [200] * fits
    assert codes[fits] == 429


# ── Request size ───────────────────────────────────────────────────────


def test_an_oversized_body_is_refused_from_its_declared_length(client):
    r = client.post(
        "/api/v1/subspaces/x/notes",
        content=b"{}",
        headers={"content-length": str(MAX_BODY_BYTES + 1), "content-type": "application/json"},
    )
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "payload_too_large"


def test_the_upload_route_gets_the_larger_limit(client):
    r = client.post(
        f"/api/v1/subspaces/{SUBSPACE}/documents",
        content=b"x",
        headers={"content-length": str(MAX_UPLOAD_BYTES + 1), "content-type": "multipart/form-data; boundary=x"},
    )
    assert r.status_code == 413
    assert MAX_UPLOAD_BYTES > MAX_BODY_BYTES


def test_a_body_that_lies_about_its_length_is_still_cut_off(client):
    def chunks():
        for _ in range(14):
            yield b"a" * (1024 * 1024)

    r = client.post(
        "/api/v1/subspaces/x/notes", content=chunks(), headers={"content-type": "application/json"}
    )
    assert r.status_code == 413
