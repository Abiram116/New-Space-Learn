"""Regression tests for the 2026-10 security pass.

Each block names the weakness it closes. Nothing here touches the network:
signing keys are made in-process and Supabase's endpoints are stubbed.
"""

from __future__ import annotations

import asyncio
import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from jose import jwk, jwt

from app.config import settings
from app.errors import Unauthorized, UpstreamUnavailable
from app.main import create_app
from app.services import admin_gate, ratelimit, supabase

KID = "test-kid"
USER = "11111111-2222-4333-8444-555555555555"


def _keypair():
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return private, public


PRIVATE, PUBLIC = _keypair()
OTHER_PRIVATE, _ = _keypair()


def _token(private=PRIVATE, *, kid=KID, alg="ES256", **overrides) -> str:
    claims = {"sub": USER, "aud": "authenticated", "role": "authenticated", "exp": int(time.time()) + 600}
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, private, algorithm=alg, headers={"kid": kid})


@pytest.fixture
def keys(monkeypatch):
    """This project's key set already fetched, and every way out of the process
    recorded rather than made."""
    calls = {"jwks": 0, "network": 0}
    public_jwk = jwk.construct(PUBLIC, "ES256").to_dict()
    public_jwk.update({"kid": KID, "alg": "ES256"})

    async def refresh():
        calls["jwks"] += 1
        supabase._jwks_attempted_at = time.monotonic()

    async def network(token):
        calls["network"] += 1
        raise Unauthorized("Your session has expired.")

    monkeypatch.setattr(supabase, "_jwks", {KID: public_jwk})
    monkeypatch.setattr(supabase, "_jwks_fetched_at", time.monotonic())
    monkeypatch.setattr(supabase, "_jwks_attempted_at", time.monotonic())
    monkeypatch.setattr(supabase, "_token_cache", {})
    monkeypatch.setattr(supabase, "_refresh_jwks", refresh)
    monkeypatch.setattr(supabase, "_verify_via_network", network)
    monkeypatch.setattr(settings, "supabase_jwt_secret", "")
    return calls


def _verify(token: str):
    return asyncio.run(supabase.verify_access_token(token))


# ── JWT verification ───────────────────────────────────────────────────


def test_a_good_token_is_accepted_locally(keys):
    assert _verify(_token())["sub"] == USER
    assert keys["network"] == 0


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(dict(exp=1_000_000_000), id="expired"),
        pytest.param(dict(aud="something-else"), id="wrong audience"),
        pytest.param(dict(aud=None), id="no audience"),
        pytest.param(dict(exp=None), id="never expires"),
        pytest.param(dict(sub=None), id="no subject"),
    ],
)
def test_a_token_our_key_refuses_is_refused_without_asking_supabase(keys, bad):
    """Previously a token that failed against a key we hold went on to the
    network check — and the audience was never checked at all."""
    with pytest.raises(Unauthorized):
        _verify(_token(**bad))
    assert keys["network"] == 0


def test_a_forged_signature_is_refused_locally(keys):
    with pytest.raises(Unauthorized):
        _verify(_token(OTHER_PRIVATE))
    assert keys["network"] == 0


def test_the_token_cannot_choose_its_own_algorithm(keys):
    """The key's own `alg` decides, not the header: ES384 against our ES256 key
    is refused even though the header asks for it."""
    from cryptography.hazmat.primitives.asymmetric import ec as _ec

    p384 = _ec.generate_private_key(_ec.SECP384R1()).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    with pytest.raises(Unauthorized):
        _verify(_token(p384, alg="ES384"))


def test_hs256_signed_with_the_public_key_is_not_accepted(keys):
    """Classic algorithm confusion: the public key used as an HMAC secret."""
    import base64
    import hashlib
    import hmac
    import json

    def b64(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    head = b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": KID}).encode())
    body = b64(json.dumps({"sub": USER, "aud": "authenticated", "exp": int(time.time()) + 600}).encode())
    sig = b64(hmac.new(PUBLIC, f"{head}.{body}".encode(), hashlib.sha256).digest())
    token = f"{head}.{body}.{sig}"
    with pytest.raises(Unauthorized):
        _verify(token)


def test_alg_none_is_not_accepted(keys):
    import base64
    import json

    def b64(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    token = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64({'sub': USER, 'aud': 'authenticated'})}."
    with pytest.raises(Unauthorized):
        _verify(token)
    assert keys["network"] == 0, "an unsigned token is refused without calling out"


def test_made_up_key_ids_cannot_make_us_refetch_keys_per_request(keys, monkeypatch):
    """The `kid` is the sender's choice. Each unknown one used to force a key-set
    fetch, so a stream of them — no sign-in needed — was a stream of calls out."""
    monkeypatch.setattr(supabase, "_jwks_attempted_at", time.monotonic() - 3600)
    for i in range(20):
        with pytest.raises(Unauthorized):
            _verify(_token(kid=f"made-up-{i}"))
    assert keys["jwks"] == 1
    assert keys["network"] == 0


def test_with_no_key_set_the_network_check_still_fails_closed(keys, monkeypatch):
    """Supabase unreachable for the key set AND for the user check: refused,
    never let through."""
    monkeypatch.setattr(supabase, "_jwks", {})

    async def offline(token):
        raise UpstreamUnavailable("Auth service is offline.")

    monkeypatch.setattr(supabase, "_verify_via_network", offline)
    with pytest.raises(UpstreamUnavailable):
        _verify(_token())


def test_hs256_with_the_project_secret_checks_audience_too(keys, monkeypatch):
    monkeypatch.setattr(settings, "supabase_jwt_secret", "s" * 40)
    good = jwt.encode(
        {"sub": USER, "aud": "authenticated", "exp": int(time.time()) + 600}, "s" * 40, algorithm="HS256"
    )
    assert _verify(good)["sub"] == USER
    # The project's own anon key is HS256 under the same secret, with no `sub`
    # and a different role — it is not a student's session.
    anon = jwt.encode({"role": "anon", "exp": int(time.time()) + 600}, "s" * 40, algorithm="HS256")
    with pytest.raises(Unauthorized):
        _verify(anon)


# ── Client address for rate limits ─────────────────────────────────────


@pytest.fixture
def unlock_client(monkeypatch):
    monkeypatch.setattr(settings, "admin_password_hash", admin_gate.hash_password("correct horse battery"))
    ratelimit.reset()
    return TestClient(create_app())


def test_rotating_x_forwarded_for_does_not_reset_the_unlock_limit(unlock_client):
    """The first `X-Forwarded-For` entry is whatever the sender wrote. Behind
    Render's Cloudflare edge, `CF-Connecting-IP` is set by the edge itself."""
    codes = [
        unlock_client.post(
            "/api/v1/admin/unlock",
            json={"password": "wrong guess"},
            headers={"CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": f"10.0.0.{i}"},
        ).status_code
        for i in range(6)
    ]
    assert codes == [403] * 5 + [429]


# ── Response headers ───────────────────────────────────────────────────


def test_every_api_response_carries_the_hardening_headers():
    client = TestClient(create_app())
    for r in (
        client.get("/api/v1/health"),
        client.get("/api/v1/spaces"),  # 401
        client.post("/api/v1/spaces", content=b"x" * 10, headers={"content-length": str(13 * 1024 * 1024)}),
    ):
        assert r.headers["x-content-type-options"] == "nosniff", r.status_code
        assert r.headers["x-frame-options"] == "DENY"
        assert "default-src 'none'" in r.headers["content-security-policy"]
        assert r.headers["referrer-policy"] == "no-referrer"
        assert "max-age" in r.headers["strict-transport-security"]


def test_cors_refuses_a_foreign_origin():
    client = TestClient(create_app())
    r = client.options(
        "/api/v1/spaces",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert r.headers.get("access-control-allow-origin") is None


def test_api_docs_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(settings, "expose_api_docs", False)
    client = TestClient(create_app())
    for path in ("/api/v1/docs", "/api/v1/openapi.json", "/api/v1/redoc"):
        assert client.get(path).status_code == 404


# ── Validation errors ──────────────────────────────────────────────────


def test_a_validation_error_does_not_echo_what_was_sent(monkeypatch):
    async def verify(token):
        return {"sub": USER, "exp": int(time.time()) + 600}

    monkeypatch.setattr(supabase, "verify_access_token", verify)
    client = TestClient(create_app())
    secret = "sk-live-" + "x" * 5000
    r = client.post("/api/v1/spaces", json={"name": secret}, headers={"Authorization": "Bearer t"})
    assert r.status_code == 422
    assert "sk-live" not in r.text
    assert r.json()["error"]["detail"][0]["loc"][-1] == "name"


# ── Size limits on bodies ──────────────────────────────────────────────


@pytest.mark.parametrize(
    ("model", "body"),
    [
        ("SkillCreate", {"name": "n", "instructions": "i", "description": "d" * 501}),
        ("SkillCreate", {"name": "n", "instructions": "i", "capabilities": ["docs"] * 11}),
        ("SkillCreate", {"name": "n", "instructions": "i", "capabilities": ["c" * 41]}),
        ("SkillCreate", {"name": "n", "instructions": "i", "icon": "i" * 41}),
        ("SkillUpdate", {"description": "d" * 501}),
        ("FlashcardCreate", {"front": "f", "back": "b", "source": "s" * 301}),
        ("FlashcardUpdate", {"source": "s" * 301}),
        ("QuizSubmit", {"answers": [0] * 101}),
        ("FeedbackIn", {"surface": "chat", "target_id": "t" * 65, "subspace_id": "s", "kind": "too_long"}),
        ("SubspaceLinkCreate", {"linked_subspace_id": "x" * 65}),
        ("FeedbackQuestionCreate", {"prompt": "Why?", "kind": "choice", "options": ["o"] * 51}),
        ("FeedbackReorder", {"ids": ["x" * 65]}),
    ],
)
def test_every_free_text_or_list_field_is_bounded(model, body):
    from pydantic import ValidationError

    from app import schemas

    with pytest.raises(ValidationError):
        getattr(schemas, model).model_validate(body)


# ── Skills: no enumeration oracle ──────────────────────────────────────


def test_activating_someone_elses_private_skill_is_a_404_not_a_403(monkeypatch):
    """A 403 confirmed that a private skill exists under that id."""
    from app.errors import NotFound
    from app.routers import skills

    async def db_select(table, **_):
        return [{"id": "s1", "user_id": "someone-else", "is_library": False}]

    monkeypatch.setattr(supabase, "db_select", db_select)
    with pytest.raises(NotFound):
        asyncio.run(skills._assert_can_use_skill(USER, "s1"))


def test_cors_does_not_offer_credentials_to_the_real_origin(monkeypatch):
    """Sessions travel as a bearer header, not a cookie: nothing for
    `Access-Control-Allow-Credentials` to allow."""
    client = TestClient(create_app())
    origin = settings.cors_origin_list[0]
    r = client.options(
        "/api/v1/spaces",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"},
    )
    assert r.headers.get("access-control-allow-origin") == origin
    assert r.headers.get("access-control-allow-credentials") is None
