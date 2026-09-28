"""The Home brief's generation cache.

Home used to pay a full model round trip on every render (~814ms measured,
plus Groq quota) to rewrite the same sentence about the same facts. The cache
key is a hash of the prompt — which IS the brief's complete input — so these
tests pin the three properties that make that safe: a repeat render skips the
model, any change to the facts regenerates, and a fallback is never cached.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.config import settings
from app.routers.me import brief as brief_module
from app.schemas import BriefOut

USER = SimpleNamespace(id="user-1")


class _CountingLLM:
    def __init__(self, reply: str = "Attention mechanisms\nRevisit the scaled dot-product maths next.") -> None:
        self.calls = 0
        self.reply = reply
        self.fail = False

    async def stream_chat(self, messages, *, model=None, temperature=0.4):
        self.calls += 1
        if self.fail:
            raise RuntimeError("upstream down")
        yield self.reply


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch):
    llm = _CountingLLM()
    facts = {"topic": "Attention"}

    async def _snapshot(_uid):
        return object()

    async def _suggestion(_snap):
        return None

    monkeypatch.setattr(settings, "groq_api_key", "test-key")
    monkeypatch.setattr(brief_module.student_model_service, "snapshot", _snapshot)
    monkeypatch.setattr(brief_module, "_brief_facts", lambda _snap: dict(facts))
    monkeypatch.setattr(brief_module, "_format_facts", lambda f: repr(sorted(f.items())))
    monkeypatch.setattr(brief_module, "_compute_suggestion", _suggestion)
    monkeypatch.setattr(brief_module.personalization, "render", lambda _snap, _task: "")
    monkeypatch.setattr(
        brief_module,
        "_fallback_brief",
        lambda _f, s: BriefOut(headline="Pick up", body="Where you left off.", generated=False, suggestion=s),
    )
    monkeypatch.setattr(brief_module, "get_llm", lambda: llm)
    brief_module._brief_cache.clear()  # noqa: SLF001
    return SimpleNamespace(llm=llm, facts=facts)


async def test_a_repeat_render_with_the_same_facts_skips_the_model(harness):
    first = await brief_module.brief(USER)
    second = await brief_module.brief(USER)
    assert first.generated and second.generated
    assert (first.headline, first.body) == (second.headline, second.body)
    assert harness.llm.calls == 1


async def test_changed_facts_regenerate(harness):
    await brief_module.brief(USER)
    harness.facts["topic"] = "Q-learning"  # the student studied something new
    await brief_module.brief(USER)
    assert harness.llm.calls == 2


async def test_a_fallback_is_never_cached(harness):
    harness.llm.fail = True
    fallback = await brief_module.brief(USER)
    assert fallback.generated is False

    # Upstream recovers: the next render must try again, not replay the fallback.
    harness.llm.fail = False
    recovered = await brief_module.brief(USER)
    assert recovered.generated is True
    assert harness.llm.calls == 2


async def test_one_students_cache_never_serves_another(harness):
    await brief_module.brief(USER)
    await brief_module.brief(SimpleNamespace(id="user-2"))
    assert harness.llm.calls == 2
