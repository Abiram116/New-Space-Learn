"""Starter questions: made from a topic's own headings, never generic, never blocking."""

from __future__ import annotations

import pytest

from app.services import starters


def test_clean_keeps_short_questions_only():
    assert starters.clean("  what is a convolution?  ") == "What is a convolution?"
    assert starters.clean("Summarise everything") is None  # not a question
    assert starters.clean("x" * 200 + "?") is None
    assert starters.clean(None) is None
    assert starters.clean("[[next: what?]]") is None


def test_boilerplate_headings_are_skipped():
    rows = [
        {"id": "1", "document_id": "d", "chunk_index": 0, "section": "Introduction"},
        {"id": "2", "document_id": "d", "chunk_index": 1, "section": "Optimisers › Momentum"},
        {"id": "3", "document_id": "d", "chunk_index": 2, "section": "References"},
        {"id": "4", "document_id": "d", "chunk_index": 3, "section": "Chapter 3"},
    ]
    assert [p["leaf"] for p in starters._spread(rows, 10)] == ["Momentum"]


def test_spread_takes_from_every_file():
    rows = [{"id": str(i), "document_id": "a", "chunk_index": i, "section": f"Topic A{i}"} for i in range(10)]
    rows += [{"id": f"b{i}", "document_id": "b", "chunk_index": i, "section": f"Topic B{i}"} for i in range(2)]
    leaves = [p["leaf"] for p in starters._spread(rows, 4)]
    assert "Topic B0" in leaves and "Topic B1" in leaves


def test_headings_alone_make_questions():
    qs = starters.from_headings(["Backpropagation", "Attention"])
    assert qs == ["What is Backpropagation?", "How does Attention work?"]


@pytest.mark.asyncio
async def test_model_questions_are_used_and_cached(monkeypatch):
    rows = [
        {"id": "1", "document_id": "d", "chunk_index": 0, "section": "Self-attention"},
        {"id": "2", "document_id": "d", "chunk_index": 1, "section": "Positional encoding"},
    ]
    calls = {"select": 0, "model": 0}

    async def fake_select(table, *, filters=None, select="*", order=None, limit=None):
        calls["select"] += 1
        if "content" in select:
            return [{"id": "1", "section": "Self-attention", "content": "Each token attends to every other token."}]
        return rows

    async def fake_model(prompt: str) -> str:
        calls["model"] += 1
        assert "Self-attention" in prompt
        return '```json\n{"questions": ["What is self-attention?", "Why add positional encoding?", "summary"]}\n```'

    monkeypatch.setattr(starters.supabase, "db_select", fake_select)
    monkeypatch.setattr(starters, "_ask_model", fake_model)
    monkeypatch.setattr(starters.settings, "groq_api_key", "test", raising=False)
    starters._CACHE.clear()
    if not starters.settings.llm_configured:
        pytest.skip("model not configurable in this environment")

    first = await starters.for_subspace("u", "s")
    assert first == ["What is self-attention?", "Why add positional encoding?"]
    again = await starters.for_subspace("u", "s")
    assert again == first and calls["model"] == 1


@pytest.mark.asyncio
async def test_a_failing_model_falls_back_to_headings(monkeypatch):
    rows = [{"id": "1", "document_id": "d", "chunk_index": 0, "section": "Gradient descent"}]

    async def fake_select(table, *, filters=None, select="*", order=None, limit=None):
        return rows if "content" not in select else []

    async def boom(prompt: str) -> str:
        raise TimeoutError

    monkeypatch.setattr(starters.supabase, "db_select", fake_select)
    monkeypatch.setattr(starters, "_ask_model", boom)
    starters._CACHE.clear()
    assert await starters.for_subspace("u", "s2") == ["What is Gradient descent?"]


@pytest.mark.asyncio
async def test_no_files_no_questions(monkeypatch):
    async def fake_select(*a, **k):
        return []

    monkeypatch.setattr(starters.supabase, "db_select", fake_select)
    assert await starters.for_subspace("u", "s3") == []


def test_the_prompt_names_the_topic_so_a_stray_section_is_not_asked_about():
    prompt = starters._PROMPT.format(
        count=4,
        topic="Classes",
        subject_clause=' in the subject "Python"',
        subject_rule=', read in the sense it has in "Python"',
        headings="- Inheritance\n- uvicorn main:app",
        excerpts="(none)",
    )
    assert 'topic "Classes"' in prompt and 'subject "Python"' in prompt
    assert "skip those and never ask about them" in prompt
