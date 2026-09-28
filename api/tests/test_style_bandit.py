"""Thompson-sampling bandit for explanation style — the RL loop.

Every `sample()` call here passes a seeded `random.Random`, so a run either
always picks a given arm or never does. The interesting assertions are about
the POSTERIORS the reads fold (`_posteriors`), not about getting lucky with a
live RNG — `sample()` itself is exercised mainly to prove it reads the gate
and the shape right, not to re-verify Python's own `betavariate`.
"""

from __future__ import annotations

import random
from datetime import UTC, datetime, timedelta

import pytest

from app.services import style_bandit as sb
from app.services.preferences import Preference

from .conftest import OWNER


def _at(days_ago: float) -> str:
    return (datetime.now(UTC) - timedelta(days=days_ago)).isoformat()


def _msg(id_: str, style: dict) -> dict:
    return {"id": id_, "user_id": OWNER, "meta": {"style": style}}


def _fb(target_id: str, kind: str, days_ago: float = 1) -> dict:
    return {
        "user_id": OWNER,
        "kind": kind,
        "target_id": target_id,
        "created_at": _at(days_ago),
    }


# ── The gate: only explore keys with nothing actionable ─────────────────


@pytest.mark.asyncio
async def test_no_db_reads_when_every_key_is_already_actionable(db):
    """"Once a key has an actionable preference, stop exploring it" — and
    stop paying for the reads that exploring it would need."""
    prefs = {
        key: Preference(key, values[0], "feedback", 0.9, 5, "earned")
        for key, values in sb.ARMS.items()
    }
    out = await sb.sample(OWNER, prefs, rng=random.Random(1))
    assert out == {}
    assert db.selects == []


@pytest.mark.asyncio
async def test_samples_only_the_keys_missing_an_actionable_preference(db):
    prefs = {
        "explanation.length": Preference(
            "explanation.length", "concise", "explicit", 0.9, 1, "you set this"
        ),
    }
    out = await sb.sample(OWNER, prefs, rng=random.Random(1))
    assert set(out) == {"explanation.depth", "explanation.opens_with"}


@pytest.mark.asyncio
async def test_a_non_actionable_existing_preference_still_gets_explored(db):
    """Actionability is the gate, not mere presence — a key sitting below
    `ACT_THRESHOLD` (e.g. one weak feedback tap) hasn't earned exclusivity."""
    prefs = {
        "explanation.length": Preference(
            "explanation.length", "concise", "feedback", 0.1, 1, "one weak tap"
        ),
    }
    out = await sb.sample(OWNER, prefs, rng=random.Random(1))
    assert "explanation.length" in out


@pytest.mark.asyncio
async def test_sampled_preferences_render_like_any_other_actionable_one(db):
    out = await sb.sample(OWNER, {}, rng=random.Random(7))
    assert set(out) == set(sb.ARMS)
    for key, pref in out.items():
        assert pref.source == "experiment"
        assert pref.value in sb.ARMS[key]
        assert pref.actionable


@pytest.mark.asyncio
async def test_sampling_is_deterministic_under_a_seeded_rng(db):
    first = await sb.sample(OWNER, {}, rng=random.Random(42))
    second = await sb.sample(OWNER, {}, rng=random.Random(42))
    assert {k: p.value for k, p in first.items()} == {
        k: p.value for k, p in second.items()
    }


# ── Posteriors: what the reads actually fold ─────────────────────────────


@pytest.mark.asyncio
async def test_useful_credits_every_arm_the_message_used(db):
    db.seed(
        "chat_messages",
        [_msg("m1", {"explanation.length": "concise", "explanation.depth": "simpler"})],
    )
    db.seed("response_feedback", [_fb("m1", "useful")])
    posteriors = await sb._posteriors(OWNER)
    assert posteriors[("explanation.length", "concise")][0] > 1.0  # alpha grew
    assert posteriors[("explanation.depth", "simpler")][0] > 1.0


@pytest.mark.asyncio
async def test_regenerate_penalizes_every_arm_the_message_used(db):
    db.seed("chat_messages", [_msg("m1", {"explanation.length": "concise"})])
    db.seed("response_feedback", [_fb("m1", "regenerate")])
    posteriors = await sb._posteriors(OWNER)
    assert posteriors[("explanation.length", "concise")][1] > 1.0  # beta grew


@pytest.mark.asyncio
async def test_agreeing_chip_rewards_the_applied_value(db):
    db.seed("chat_messages", [_msg("m1", {"explanation.length": "concise"})])
    db.seed("response_feedback", [_fb("m1", "too_long")])  # argues "concise" — agrees
    posteriors = await sb._posteriors(OWNER)
    assert posteriors[("explanation.length", "concise")][0] > 1.0


@pytest.mark.asyncio
async def test_contradicting_chip_penalizes_the_applied_value(db):
    db.seed("chat_messages", [_msg("m1", {"explanation.length": "concise"})])
    db.seed("response_feedback", [_fb("m1", "want_detail")])  # argues "detailed" — contradicts
    posteriors = await sb._posteriors(OWNER)
    assert posteriors[("explanation.length", "concise")][1] > 1.0


@pytest.mark.asyncio
async def test_feedback_on_a_message_with_no_recorded_style_is_ignored(db):
    db.seed("chat_messages", [_msg("m1", {})])
    db.seed("response_feedback", [_fb("m1", "useful")])
    assert await sb._posteriors(OWNER) == {}


@pytest.mark.asyncio
async def test_style_key_outside_the_bandit_is_ignored(db):
    """`want_direct` maps to `interaction.answer_mode`, not one of the three
    bandit arms — must not be folded even if a chip for it lands on a
    message that also has a real style arm."""
    db.seed("chat_messages", [_msg("m1", {"explanation.length": "concise"})])
    db.seed("response_feedback", [_fb("m1", "want_direct")])
    assert await sb._posteriors(OWNER) == {}


@pytest.mark.asyncio
async def test_no_feedback_means_no_update(db):
    """Silence is not a reward — a message with a recorded style but no
    feedback at all must not move any posterior."""
    db.seed("chat_messages", [_msg("m1", {"explanation.length": "concise"})])
    assert await sb._posteriors(OWNER) == {}


@pytest.mark.asyncio
async def test_lopsided_history_produces_a_lopsided_posterior(db):
    """Ten straight `useful` taps on the same value should read as
    overwhelmingly in its favour — the fold `sample()`'s draw depends on."""
    db.seed("chat_messages", [_msg(f"m{i}", {"explanation.length": "concise"}) for i in range(10)])
    db.seed("response_feedback", [_fb(f"m{i}", "useful", days_ago=1) for i in range(10)])
    alpha, beta = (await sb._posteriors(OWNER))[("explanation.length", "concise")]
    assert alpha > beta * 5


# ── Decay ──────────────────────────────────────────────────────────────


def test_decay_is_full_for_fresh_rewards():
    now = datetime.now(UTC)
    assert sb._decay(now.isoformat(), now) == pytest.approx(1.0, abs=0.02)


def test_decay_halves_at_the_half_life():
    now = datetime.now(UTC)
    at = (now - timedelta(days=sb.REWARD_HALF_LIFE_DAYS)).isoformat()
    assert sb._decay(at, now) == pytest.approx(0.5, abs=0.02)


def test_decay_is_zero_for_unparsable_timestamps():
    assert sb._decay("nonsense", datetime.now(UTC)) == 0.0
