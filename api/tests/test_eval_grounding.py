"""The grounding check's measured behaviour, pinned (see eval/grounding.py).

Not a claim that it is good at everything: paraphrases and flipped verbs are
known misses and are recorded as such in the README. This only stops the parts
that work from quietly getting worse.
"""

from eval import grounding


def test_what_the_check_is_known_to_do_stays_true():
    out = grounding.run()
    g = out["by_group"]
    assert g["verbatim"]["correct"] == g["verbatim"]["n"]
    assert g["reworded"]["correct"] == g["reworded"]["n"]
    assert g["fabricated"]["correct"] == g["fabricated"]["n"], "an invented detail must never get a tick"
    assert g["off-topic"]["correct"] == g["off-topic"]["n"]
    # The swapped-number cases are the ones a word-overlap score alone gets wrong.
    numeric = [w for w in g["tampered"]["wrong"] if any(ch.isdigit() for ch in w["claim"])]
    assert numeric == []
    assert out["precision_of_backed"] >= 0.8, "a tick must mean something"
