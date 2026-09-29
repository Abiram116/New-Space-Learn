"""Personalization's teaching-strategy wiring — the `render_chat` →
`style_bandit.sample` handoff, and the instruction each arm renders as.

`style_bandit`'s own tests cover the bandit's arithmetic in isolation,
against a fake DB. These pin the two things that live on this side of the
boundary instead: `render_chat` finds a chat's subject id for free from the
snapshot it already has (no second query), and every `teaching.strategy` arm
actually renders as an instruction a model can follow.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.services import personalization
from app.services import student_model as sm
from app.services import style_bandit as sb
from app.services.preferences import Preference


def _topic(subspace_id: str, subject_id: str) -> sm.TopicView:
    return sm.TopicView(
        subspace_id=subspace_id,
        subject_id=subject_id,
        subject="Untitled",
        topic="Untitled",
        quiz_average=None,
        quiz_attempts=0,
        trend=None,
        days_since_activity=None,
        cards_due=0,
        cards_total=0,
        notes=0,
        docs=0,
    )


def _snap(topics: list[sm.TopicView]) -> sm.Snapshot:
    return sm.Snapshot(settings={}, topics=topics, concepts=[], activity_days=[], streak_days=0)


# ── Rendering ────────────────────────────────────────────────────────────


def test_every_strategy_arm_has_a_rendered_instruction():
    """A new arm added to `style_bandit.STRATEGY_ARMS` with no matching entry
    here would render nothing — a silently inert experiment, indistinguishable
    from a bug, since `sample()` would still pick it and record it."""
    assert set(personalization._STRATEGY_INSTRUCTIONS) == set(sb.STRATEGY_ARMS)
    for instruction in personalization._STRATEGY_INSTRUCTIONS.values():
        assert instruction and instruction[0].isupper()


def test_style_renders_the_sampled_strategy_instruction():
    prefs = {
        "teaching.strategy": Preference(
            "teaching.strategy", "step_by_step", "experiment", 1.0, 0, "trying this"
        )
    }
    lines = personalization._style(prefs)
    assert personalization._STRATEGY_INSTRUCTIONS["step_by_step"] in lines


def test_style_omits_strategy_when_not_actionable():
    prefs = {
        "teaching.strategy": Preference(
            "teaching.strategy", "step_by_step", "observed", 0.1, 1, "x"
        )
    }
    assert personalization._style(prefs) == []


# ── render_chat wiring ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_render_chat_derives_subject_id_from_the_snapshots_own_topics(monkeypatch):
    """The whole point of reading `snap.topics` instead of querying
    `subspaces` again: this costs nothing extra. Pinned by intercepting the
    call `style_bandit.sample` actually receives."""
    snap = _snap([_topic("sub-1", "subject-a"), _topic("sub-2", "subject-b")])
    captured: dict[str, Any] = {}

    async def fake_sample(user_id, prefs, *, subject_id=None, subject_by_subspace=None, rng=None):
        captured["subject_id"] = subject_id
        captured["subject_by_subspace"] = subject_by_subspace
        return {}

    monkeypatch.setattr(sb, "sample", fake_sample)
    await personalization.render_chat(snap, "sub-1", "user-1")

    assert captured["subject_id"] == "subject-a"
    assert captured["subject_by_subspace"] == {"sub-1": "subject-a", "sub-2": "subject-b"}


@pytest.mark.asyncio
async def test_render_chat_subject_id_is_none_outside_any_subspace(monkeypatch):
    snap = _snap([_topic("sub-1", "subject-a")])
    captured: dict[str, Any] = {}

    async def fake_sample(user_id, prefs, *, subject_id=None, subject_by_subspace=None, rng=None):
        captured["subject_id"] = subject_id
        return {}

    monkeypatch.setattr(sb, "sample", fake_sample)
    await personalization.render_chat(snap, None, "user-1")

    assert captured["subject_id"] is None


@pytest.mark.asyncio
async def test_render_chat_persists_the_sampled_strategy_to_meta_style(monkeypatch):
    """`style_values` is what `subspace_chat.py` writes to
    `chat_messages.meta.style` — the ledger `style_bandit` reads back later,
    so a sampled strategy must actually reach it."""
    snap = _snap([_topic("sub-1", "subject-a")])

    async def fake_sample(user_id, prefs, *, subject_id=None, subject_by_subspace=None, rng=None):
        return {
            "teaching.strategy": Preference(
                "teaching.strategy", "socratic", "experiment", 1.0, 0, "trying this"
            )
        }

    monkeypatch.setattr(sb, "sample", fake_sample)
    _, _, style_values = await personalization.render_chat(snap, "sub-1", "user-1")

    assert style_values["teaching.strategy"] == "socratic"
