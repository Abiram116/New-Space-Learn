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

SUBJECT_A = "aaaaaaaa-0000-0000-0000-000000000001"
SUBJECT_B = "bbbbbbbb-0000-0000-0000-000000000002"


@pytest.fixture(autouse=True)
def _clear_read_cache():
    """`_cached_reads` memoizes per user across calls — harmless in
    production (that's the point), but poison across tests, which reuse the
    same `OWNER` id with different seeded data every time. Clear before AND
    after so no test leaks a cached read into the next one."""
    sb._read_cache.clear()
    yield
    sb._read_cache.clear()


def _at(days_ago: float) -> str:
    return (datetime.now(UTC) - timedelta(days=days_ago)).isoformat()


def _msg(id_: str, style: dict, subspace_id: str = "sub-1") -> dict:
    return {
        "id": id_,
        "user_id": OWNER,
        "subspace_id": subspace_id,
        "meta": {"style": style},
    }


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


# ── teaching.strategy: gating ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_strategy_not_explored_without_a_subject(db):
    """No subject, no context to learn within — `sample()` skips it rather
    than drawing blind."""
    out = await sb.sample(OWNER, {}, rng=random.Random(1))
    assert sb.STRATEGY_KEY not in out


@pytest.mark.asyncio
async def test_strategy_explored_when_subject_given_and_nothing_covers_it(db):
    out = await sb.sample(OWNER, {}, subject_id=SUBJECT_A, rng=random.Random(1))
    assert sb.STRATEGY_KEY in out
    pref = out[sb.STRATEGY_KEY]
    assert pref.value in sb.STRATEGY_ARMS
    assert pref.source == "experiment"
    assert pref.actionable


@pytest.mark.asyncio
async def test_strategy_skipped_once_it_is_already_actionable(db):
    prefs = {
        sb.STRATEGY_KEY: Preference(sb.STRATEGY_KEY, "step_by_step", "experiment", 1.0, 0, "x")
    }
    out = await sb.sample(OWNER, prefs, subject_id=SUBJECT_A, rng=random.Random(1))
    assert sb.STRATEGY_KEY not in out


@pytest.mark.asyncio
async def test_strategy_skipped_when_an_explicit_note_covers_it(db):
    """The simplest honest gate available: `explanation.note` is the
    intake's free-text answer for how to teach this student — an explicit
    statement of exactly the thing the bandit would otherwise be guessing
    at, so it counts as covering `teaching.strategy` too."""
    prefs = {
        "explanation.note": Preference(
            "explanation.note", "walk me through step by step", "explicit", 0.9, 1, "you set this"
        )
    }
    out = await sb.sample(OWNER, prefs, subject_id=SUBJECT_A, rng=random.Random(1))
    assert sb.STRATEGY_KEY not in out


@pytest.mark.asyncio
async def test_no_db_reads_when_nothing_needs_exploring_including_strategy(db):
    prefs = {
        key: Preference(key, values[0], "feedback", 0.9, 5, "earned")
        for key, values in sb.ARMS.items()
    }
    prefs[sb.STRATEGY_KEY] = Preference(sb.STRATEGY_KEY, "step_by_step", "experiment", 1.0, 0, "x")
    out = await sb.sample(OWNER, prefs, subject_id=SUBJECT_A, rng=random.Random(1))
    assert out == {}
    assert db.selects == []


# ── teaching.strategy: prior ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_every_arm_starts_at_beta_1_1_except_code_first(db):
    posteriors = await sb._strategy_posteriors(OWNER, SUBJECT_A, {})
    assert posteriors["code_first"] == (1.0, 2.0)
    for arm in sb.STRATEGY_ARMS:
        if arm != "code_first":
            assert posteriors[arm] == (1.0, 1.0)


# ── teaching.strategy: reward mapping ──────────────────────────────────────


@pytest.mark.asyncio
async def test_useful_scores_one_for_the_applied_strategy_arm(db):
    db.seed("chat_messages", [_msg("m1", {"teaching.strategy": "socratic"})])
    db.seed("response_feedback", [_fb("m1", "useful")])
    global_evid, _ = await sb._strategy_evidence(OWNER, {})
    alpha_evid, beta_evid = global_evid["socratic"]
    assert alpha_evid > 0.9
    assert beta_evid == 0.0


@pytest.mark.asyncio
async def test_regenerate_scores_zero_for_the_applied_strategy_arm(db):
    db.seed("chat_messages", [_msg("m1", {"teaching.strategy": "socratic"})])
    db.seed("response_feedback", [_fb("m1", "regenerate")])
    global_evid, _ = await sb._strategy_evidence(OWNER, {})
    alpha_evid, beta_evid = global_evid["socratic"]
    assert alpha_evid == 0.0
    assert beta_evid > 0.9


@pytest.mark.asyncio
async def test_directional_chip_also_scores_zero_for_the_strategy_arm(db):
    """Unlike the style arms, a directional chip has no agree/disagree read
    against `teaching.strategy` — `need_example` argues about explanation
    STYLE, not about whether `example_first` specifically was the right
    strategy, so it counts against the arm just like `regenerate` does."""
    db.seed("chat_messages", [_msg("m1", {"teaching.strategy": "example_first"})])
    db.seed("response_feedback", [_fb("m1", "need_example")])
    global_evid, _ = await sb._strategy_evidence(OWNER, {})
    alpha_evid, beta_evid = global_evid["example_first"]
    assert alpha_evid == 0.0
    assert beta_evid > 0.9


@pytest.mark.asyncio
async def test_strategy_evidence_ignores_messages_with_no_recorded_arm(db):
    db.seed("chat_messages", [_msg("m1", {"explanation.length": "concise"})])
    db.seed("response_feedback", [_fb("m1", "useful")])
    global_evid, by_subject = await sb._strategy_evidence(OWNER, {})
    assert global_evid == {}
    assert by_subject == {}


# ── teaching.strategy: hierarchical fallback math ──────────────────────────


@pytest.mark.asyncio
async def test_hierarchical_blend_combines_global_and_subject_evidence(db):
    db.seed(
        "chat_messages",
        [
            _msg("m1", {"teaching.strategy": "step_by_step"}, subspace_id="s1"),  # subject A
            _msg("m2", {"teaching.strategy": "step_by_step"}, subspace_id="s2"),  # subject B
        ],
    )
    db.seed(
        "response_feedback",
        [_fb("m1", "useful", days_ago=1), _fb("m2", "useful", days_ago=1)],
    )
    subject_by_subspace = {"s1": SUBJECT_A, "s2": SUBJECT_B}
    posteriors = await sb._strategy_posteriors(OWNER, SUBJECT_A, subject_by_subspace)
    alpha, beta = posteriors["step_by_step"]
    # posterior = Beta(1,1) + 0.3 * global evidence (both messages) +
    # 1.0 * subject A's own evidence (m1 only).
    assert alpha == pytest.approx(1.0 + 0.3 * 2.0 + 1.0 * 1.0, abs=0.05)
    assert beta == pytest.approx(1.0, abs=0.02)


@pytest.mark.asyncio
async def test_new_subject_inherits_a_damped_global_tendency(db):
    """A subject with no evidence of its own still starts from SOMETHING —
    the student's global tendency, weighted down to 0.3 rather than taken
    at full strength."""
    db.seed(
        "chat_messages",
        [_msg("m1", {"teaching.strategy": "analogy_first"}, subspace_id="s1")],  # subject A
    )
    db.seed("response_feedback", [_fb("m1", "useful", days_ago=1)])
    subject_by_subspace = {"s1": SUBJECT_A}
    # Query subject B, which has never had a strategy message of its own.
    posteriors = await sb._strategy_posteriors(OWNER, SUBJECT_B, subject_by_subspace)
    alpha, beta = posteriors["analogy_first"]
    assert alpha == pytest.approx(1.0 + 0.3 * 1.0, abs=0.02)
    assert beta == pytest.approx(1.0, abs=0.02)


@pytest.mark.asyncio
async def test_subject_with_real_history_outweighs_the_inherited_global_prior(db):
    """Once a subject has its own evidence, it should visibly dominate the
    damped global contribution rather than being permanently diluted by it."""
    db.seed(
        "chat_messages",
        [_msg(f"m{i}", {"teaching.strategy": "code_first"}, subspace_id="s1") for i in range(8)],
    )
    db.seed(
        "response_feedback",
        [_fb(f"m{i}", "useful", days_ago=1) for i in range(8)],
    )
    subject_by_subspace = {"s1": SUBJECT_A}
    posteriors = await sb._strategy_posteriors(OWNER, SUBJECT_A, subject_by_subspace)
    alpha, beta = posteriors["code_first"]
    assert alpha > beta * 5


# ── teaching.strategy: read cache ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_cached_reads_are_reused_within_ttl(db):
    db.seed("chat_messages", [_msg("m1", {"explanation.length": "concise"})])
    db.seed("response_feedback", [_fb("m1", "useful")])
    await sb._posteriors(OWNER)
    after_first = len(db.selects)
    await sb._posteriors(OWNER)
    assert len(db.selects) == after_first


@pytest.mark.asyncio
async def test_invalidate_forces_a_fresh_read(db):
    db.seed("chat_messages", [_msg("m1", {"explanation.length": "concise"})])
    db.seed("response_feedback", [_fb("m1", "useful")])
    await sb._posteriors(OWNER)
    after_first = len(db.selects)
    sb.invalidate(OWNER)
    await sb._posteriors(OWNER)
    assert len(db.selects) > after_first


@pytest.mark.asyncio
async def test_style_and_strategy_share_one_cached_read_in_the_same_request(db):
    """`_posteriors` and `_strategy_evidence` both read through
    `_cached_reads` — exploring both dimensions in one `sample()` call must
    not double the DB round trips."""
    db.seed(
        "chat_messages",
        [_msg("m1", {"explanation.length": "concise", "teaching.strategy": "socratic"})],
    )
    db.seed("response_feedback", [_fb("m1", "useful")])
    await sb._posteriors(OWNER)
    after_style = len(db.selects)
    await sb._strategy_evidence(OWNER, {})
    assert len(db.selects) == after_style


# ── teaching.strategy: read-only summary ───────────────────────────────────


@pytest.mark.asyncio
async def test_strategy_summary_hidden_below_the_evidence_floor(db):
    db.seed(
        "chat_messages",
        [_msg("m1", {"teaching.strategy": "example_first"}, subspace_id="s1")],
    )
    db.seed("response_feedback", [_fb("m1", "useful")])
    assert await sb.strategy_summary(OWNER, {"s1": SUBJECT_A}) == []


@pytest.mark.asyncio
async def test_strategy_summary_reports_the_best_arm_once_evidence_clears_the_floor(db):
    db.seed(
        "chat_messages",
        [_msg(f"m{i}", {"teaching.strategy": "example_first"}, subspace_id="s1") for i in range(6)],
    )
    db.seed(
        "response_feedback",
        [_fb(f"m{i}", "useful", days_ago=1) for i in range(6)],
    )
    summaries = await sb.strategy_summary(OWNER, {"s1": SUBJECT_A})
    assert len(summaries) == 1
    summary = summaries[0]
    assert summary.subject_id == SUBJECT_A
    assert summary.arm == "example_first"
    assert summary.evidence >= sb.MIN_SUMMARY_EVIDENCE
    assert summary.mean > 0.8


@pytest.mark.asyncio
async def test_strategy_summary_never_reports_a_subject_with_no_evidence_of_its_own(db):
    """A subject must earn its own place in the summary — borrowed global
    signal is a fine basis for an experiment (`_strategy_posteriors`), not
    for a claim shown back to the student."""
    db.seed(
        "chat_messages",
        [_msg(f"m{i}", {"teaching.strategy": "example_first"}, subspace_id="s1") for i in range(10)],
    )
    db.seed(
        "response_feedback",
        [_fb(f"m{i}", "useful", days_ago=1) for i in range(10)],
    )
    summaries = await sb.strategy_summary(OWNER, {"s1": SUBJECT_A})
    assert all(s.subject_id != SUBJECT_B for s in summaries)
