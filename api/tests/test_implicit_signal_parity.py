"""`readSignal` (frontend) and `_IMPLICIT_PATTERNS` (backend) answer related
but different questions over the same student message, and nothing before
this file checked they stay related on purpose rather than by accident.

`_IMPLICIT_PATTERNS` decides what preference EVIDENCE to record, silently, at
`observed` confidence. `readSignal` decides whether the ask policy should
INTERRUPT the student, and its own docstring says a miss there "costs one
unnecessary offer rather than a lost signal" — which is exactly why the two
were allowed to duplicate instead of sharing one implementation. But
"allowed to duplicate" is not "allowed to silently disagree", and running
both against the same phrases surfaces one real disagreement that nobody
designed on purpose:

    "i still don't understand this" / "this makes no sense" / "i'm confused"

The backend classifies these as directed evidence toward
`(explanation.depth, simpler)` — recorded, no need to ask. The frontend
classifies the identical phrases as `confusion` — the strongest reason the ask
policy has to interrupt. Both readings are individually defensible (see the
docstrings on each side), but a phrase that is simultaneously "already
answered, don't ask" and "the single best reason to ask" is a real
disagreement, not decoration. Fixing which one is right is a product
decision, not a refactor — this file's job is to make sure that decision has
to be made *on purpose*, by pinning today's behaviour so any future change to
either regex list shows up here rather than shipping silently.

Style matches `test_sm2.py` / `sm2_parity.mjs`: run the real `readSignal.ts`
in Node, never a Python transcription of it.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app.services.preferences import _IMPLICIT_PATTERNS

PARITY_SCRIPT = Path(__file__).parent / "read_signal_parity.mjs"

# One clean, representative phrase per backend pattern — the wording each
# regex's own author chose as the canonical trigger, not an edge case.
DIRECTED_EXAMPLES: list[tuple[str, str, str]] = [
    ("can you simplify that", "explanation.depth", "simpler"),
    ("give me more detail please", "explanation.length", "detailed"),
    ("keep it shorter next time", "explanation.length", "concise"),
    ("give me an example", "explanation.opens_with", "example_first"),
    ("just give me the answer", "interaction.answer_mode", "direct"),
]

# The disagreement this file exists to pin. Backend: directed evidence for
# "simpler". Frontend: `confusion`, the strongest ask-policy trigger.
CONTESTED_CONFUSION_EXAMPLES = [
    "i still don't understand this",
    "this makes no sense",
    "i'm confused",
]

# An ordinary follow-up — neither side should classify this as anything.
NEUTRAL_EXAMPLES = ["what about the discount factor?", "how does that connect to Bellman?"]


def _run_read_signal(messages: list[str]) -> list[str]:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available — cannot verify frontend parity")

    payload = Path(__file__).parent / "_read_signal_cases.json"
    payload.write_text(json.dumps(messages), encoding="utf-8")
    try:
        proc = subprocess.run(
            [node, str(PARITY_SCRIPT), str(payload)],
            capture_output=True,
            text=True,
            cwd=PARITY_SCRIPT.parent,
        )
    finally:
        payload.unlink(missing_ok=True)

    if proc.returncode != 0:
        if "ERR_UNKNOWN_FILE_EXTENSION" in proc.stderr or "strip-types" in proc.stderr:
            pytest.skip(f"node cannot load TypeScript directly (needs ≥22): {proc.stderr[:200]}")
        pytest.fail(f"parity script failed:\n{proc.stderr[:2000]}")

    results = json.loads(proc.stdout)
    assert len(results) == len(messages)
    return results


def _backend_hits(message: str) -> set[tuple[str, str]]:
    """Which `(key, value)` pairs `_IMPLICIT_PATTERNS` would record for this
    message — same match rule as `_resolve_implicit` (`pattern.search`)."""
    return {
        (key, value)
        for pattern, key, value in _IMPLICIT_PATTERNS
        if re.search(pattern, message, re.I)
    }


def test_every_directed_example_actually_matches_its_backend_pattern() -> None:
    """Guards the fixture itself: if a maintainer edits a backend regex and
    its canonical example stops matching, that is caught here in plain
    Python before it reaches the (skippable) Node comparison below."""
    for message, key, value in DIRECTED_EXAMPLES:
        assert (key, value) in _backend_hits(message), (
            f"{message!r} no longer matches ({key}, {value}) — "
            "update the example or the pattern together"
        )


def test_frontend_agrees_on_every_undisputed_directed_phrase() -> None:
    """The real drift guard. When the backend records a stated direction, the
    ask policy must stay quiet about it — asking again would be asking a
    question the student already answered, which is `readSignal`'s own
    stated purpose for existing."""
    messages = [m for m, _, _ in DIRECTED_EXAMPLES]
    results = _run_read_signal(messages)
    for message, signal in zip(messages, results, strict=True):
        assert signal == "directed", (
            f"{message!r} is directed evidence on the backend but readSignal "
            f"returned {signal!r} — the two sides have drifted"
        )


def test_neutral_messages_agree_on_both_sides() -> None:
    for message in NEUTRAL_EXAMPLES:
        assert _backend_hits(message) == set()
    results = _run_read_signal(NEUTRAL_EXAMPLES)
    assert all(signal == "none" for signal in results)


def test_the_confusion_disagreement_is_pinned_not_accidental() -> None:
    """NOT a bug fix. This asserts today's actual, divergent behaviour on
    both sides, so a change to either regex list has to touch this test —
    and whoever touches it has to decide, consciously, whether the
    disagreement above should keep existing. Silently reconciling on one
    side (or silently drifting further) both fail this test either way."""
    for message in CONTESTED_CONFUSION_EXAMPLES:
        assert ("explanation.depth", "simpler") in _backend_hits(message), (
            f"backend no longer treats {message!r} as directed evidence — "
            "the disagreement this test pins has changed shape, update it "
            "deliberately"
        )

    results = _run_read_signal(CONTESTED_CONFUSION_EXAMPLES)
    for message, signal in zip(CONTESTED_CONFUSION_EXAMPLES, results, strict=True):
        assert signal == "confusion", (
            f"readSignal no longer classifies {message!r} as confusion — "
            "if this was a deliberate reconciliation with the backend, "
            "delete this test instead of loosening it"
        )
