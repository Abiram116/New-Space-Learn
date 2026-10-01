"""What a person reads when something goes wrong.

Never the database's wording, never a framework's developer text, never an
object printed as `{}`. These pin the sentences, not just the status codes.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app.errors import (
    Forbidden,
    NotFound,
    UpstreamUnavailable,
    ValidationFailed,
    friendly_validation_message,
)
from app.main import create_app
from app.services.supabase import _raise_if_bad


def _response(status: int, body, method: str = "POST") -> httpx.Response:
    return httpx.Response(
        status, json=body, request=httpx.Request(method, "http://db.test/rest/v1/notes")
    )


# ── Database errors ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("status", "code", "expected"),
    [
        (409, "23505", ValidationFailed),
        (409, "23503", ValidationFailed),
        (400, "23514", ValidationFailed),
        (400, "22P02", NotFound),
        (406, "PGRST116", NotFound),
        (403, "42501", Forbidden),
        (400, "XX000", UpstreamUnavailable),
    ],
)
def test_database_errors_become_plain_sentences(status, code, expected):
    body = {
        "code": code,
        "message": 'duplicate key value violates unique constraint "subspace_links_pkey"',
        "details": "Key (subspace_id, linked_subspace_id)=(a, b) already exists.",
    }
    with pytest.raises(expected) as caught:
        _raise_if_bad(_response(status, body))
    shown = caught.value.message
    for leak in ("duplicate key", "violates", "constraint", "subspace_links", "Key (", "PGRST"):
        assert leak not in shown


def test_our_own_rejected_credentials_do_not_sign_the_student_out():
    # A 401 from the database means OUR key was refused. Surfacing it as
    # `unauthorized` would make the browser drop a perfectly good session.
    with pytest.raises(UpstreamUnavailable) as caught:
        _raise_if_bad(_response(401, {"message": "Invalid API key"}))
    assert caught.value.code == "upstream_unavailable"
    assert "API key" not in caught.value.message


def test_a_non_object_error_body_is_survivable():
    with pytest.raises(UpstreamUnavailable):
        _raise_if_bad(_response(400, ["not", "an", "object"]))


# ── Request validation ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        ({"type": "missing", "loc": ("body", "name")}, "Name is required."),
        ({"type": "string_too_short", "loc": ("body", "title"), "ctx": {"min_length": 1}}, "Title can't be empty."),
        (
            {"type": "string_too_long", "loc": ("body", "body_md"), "ctx": {"max_length": 100}},
            "Body md is too long (at most 100 characters).",
        ),
        ({"type": "int_parsing", "loc": ("body", "count")}, "Count has to be a number."),
        ({"type": "literal_error", "loc": ("body", "tone")}, "Tone isn't one of the allowed choices."),
        ({"type": "json_invalid", "loc": ("body", 4)}, "That request couldn't be read. Please try again."),
        ({"type": "something_new", "loc": ("body", "x")}, "Some of the input isn't valid."),
    ],
)
def test_validation_errors_say_what_to_change(error, expected):
    assert friendly_validation_message([error]) == expected


def test_no_errors_still_gives_a_sentence():
    assert friendly_validation_message([]) == "Some of the input isn't valid."


# ── Framework errors ───────────────────────────────────────────────────


def test_an_unknown_address_is_not_reported_as_the_framework_words():
    client = TestClient(create_app())
    body = client.get("/api/v1/definitely-not-a-route").json()["error"]
    assert body["code"] == "not_found"
    assert body["message"] == "We couldn't find that."


def test_a_wrong_method_is_explained():
    client = TestClient(create_app())
    body = client.delete("/api/v1/health").json()["error"]
    assert body["code"] == "method_not_allowed"
    assert "Method Not Allowed" not in body["message"]
