"""How well does "checked against your files" tell backed claims from invented ones?

`rag.grounding` scores each cited sentence by the share of its meaningful words
found in the source it cites (no model call). That is cheap and always on, but
it is a lexical check, so it has known blind spots. This measures them on
hand-labelled cases instead of asserting that it works.

Each case is a source passage, a sentence that cites it, and whether a careful
reader would say the source really supports the sentence. Cases are grouped by
how the claim relates to the source, because the groups are where the check
differs: copying is easy, a faithful paraphrase is hard, a swapped number is
nearly invisible to a word-overlap score.

    cd api && uv run python -m eval.grounding        # prints, writes results/grounding.json
"""

from __future__ import annotations

import json
from pathlib import Path

from app.services import rag

RESULTS = Path(__file__).parent / "results" / "grounding.json"

DROPOUT = (
    "Dropout randomly zeroes a fraction of the activations during training, which reduces overfitting in large "
    "networks. At inference time dropout is switched off and the activations are scaled instead."
)
RESIDUAL = (
    "Residual connections add the input of a block to its output, so gradients can flow through the identity path. "
    "This makes very deep networks much easier to optimise."
)
ATTENTION = (
    "In scaled dot-product attention the dot products of the query with all keys are divided by the square root of "
    "the key dimension, and a softmax is applied to obtain the weights on the values."
)
TRAIN = (
    "We trained the base models for a total of 100,000 steps or 12 hours on one machine with 8 NVIDIA P100 GPUs. "
    "Each training step took about 0.4 seconds."
)
SOURCES = {"dropout": DROPOUT, "residual": RESIDUAL, "attention": ATTENTION, "train": TRAIN}

# (group, source, claim, backed)
CASES: list[tuple[str, str, str, bool]] = [
    # Copied or lightly reworded: the easy half.
    ("verbatim", "dropout", "Dropout randomly zeroes a fraction of the activations during training.", True),
    ("verbatim", "residual", "Residual connections add the input of a block to its output.", True),
    ("verbatim", "attention", "A softmax is applied to obtain the weights on the values.", True),
    ("verbatim", "train", "Each training step took about 0.4 seconds.", True),
    ("reworded", "dropout", "During training, dropout zeroes random activations, which reduces overfitting in big networks.", True),
    ("reworded", "residual", "Residual connections let gradients flow through the identity path, so deep networks optimise more easily.", True),
    ("reworded", "attention", "The query-key dot products are divided by the square root of the key dimension before the softmax.", True),
    ("reworded", "train", "The base models were trained for 100,000 steps, about 12 hours, on 8 P100 GPUs.", True),
    # Faithful but in other words: where a word-overlap score is weakest.
    ("paraphrase", "dropout", "Turning off random neurons while learning stops the model memorising its training data.", True),
    ("paraphrase", "residual", "Skip links give the error signal a shortcut back through the layers.", True),
    ("paraphrase", "attention", "Scores between a query and every key are scaled down by the key size, then normalised into weights.", True),
    ("paraphrase", "train", "Training the smaller models took half a day on a single eight-GPU server.", True),
    # Plausible but invented detail attached to a real topic.
    ("fabricated", "dropout", "Dropout was invented in 1850 by a French clockmaker named Henri.", False),
    ("fabricated", "residual", "Residual connections were first proposed for speech recognition at a telecom lab in Helsinki.", False),
    ("fabricated", "attention", "Attention was patented by a company that licenses it to every cloud provider.", False),
    ("fabricated", "train", "Training used a cluster of 512 TPU pods across three data centres in Oregon.", False),
    ("fabricated", "dropout", "Dropout always improves accuracy on every dataset by exactly two percentage points.", False),
    ("fabricated", "residual", "Residual networks require a minimum of fifty layers to work at all.", False),
    # Right words, wrong number or fact: a word-overlap score barely sees these.
    ("tampered", "train", "We trained the base models for a total of 900,000 steps or 12 hours on one machine with 8 NVIDIA P100 GPUs.", False),
    ("tampered", "train", "Each training step took about 4 seconds.", False),
    ("tampered", "attention", "The dot products are multiplied by the square root of the key dimension, and a softmax is applied.", False),
    ("tampered", "dropout", "At inference time dropout stays on and the activations are not scaled.", False),
    # Cites a source that has nothing to do with the sentence.
    ("off-topic", "dropout", "The capital of France is Paris, a city on the Seine.", False),
    ("off-topic", "residual", "Photosynthesis converts sunlight, water and carbon dioxide into glucose.", False),
    ("off-topic", "attention", "The mitochondria produce most of the chemical energy a cell needs.", False),
    ("off-topic", "train", "Roman roads connected provinces and carried legions across the empire.", False),
]


def judge(source: str, claim: str) -> bool:
    """What the product does: does the grounding check call this claim backed?"""
    # Answers cite before the full stop ("… training [[1]]."), which is what the check reads.
    result = rag.grounding(f"{claim.rstrip('.')} [[1]].", [SOURCES[source]])
    return result["checked"] == 1 and result["backed"] == 1


def run() -> dict:
    groups: dict[str, dict] = {}
    tp = fp = tn = fn = 0
    for group, source, claim, backed in CASES:
        said_backed = judge(source, claim)
        g = groups.setdefault(group, {"n": 0, "correct": 0, "wrong": []})
        g["n"] += 1
        if said_backed == backed:
            g["correct"] += 1
        else:
            g["wrong"].append({"claim": claim, "expected_backed": backed})
        tp += said_backed and backed
        fp += said_backed and not backed
        tn += (not said_backed) and not backed
        fn += (not said_backed) and backed
    n = len(CASES)
    return {
        "cases": n,
        "accuracy": round((tp + tn) / n, 3),
        # Of the claims it calls "backed", how many truly are (does a green tick mislead?).
        "precision_of_backed": round(tp / (tp + fp), 3) if tp + fp else None,
        # Of the genuinely backed claims, how many does it recognise (does it cry wolf?).
        "recall_of_backed": round(tp / (tp + fn), 3) if tp + fn else None,
        "by_group": {k: {"n": v["n"], "correct": v["correct"], "wrong": v["wrong"]} for k, v in groups.items()},
        "backed_threshold": rag._BACKED_SUPPORT,
    }


def main() -> None:
    out = run()
    RESULTS.parent.mkdir(exist_ok=True)
    RESULTS.write_text(json.dumps(out, indent=2) + "\n")
    print(f"{out['cases']} cases · accuracy {out['accuracy']:.0%} · "
          f"precision of 'backed' {out['precision_of_backed']:.0%} · recall of 'backed' {out['recall_of_backed']:.0%}")
    for name, g in out["by_group"].items():
        print(f"  {name:<11} {g['correct']}/{g['n']}")
        for w in g["wrong"]:
            print(f"      missed: {w['claim'][:90]}")


if __name__ == "__main__":
    main()
