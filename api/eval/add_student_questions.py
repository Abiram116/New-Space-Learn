"""Writes the student-notes questions into `questions.json` (idempotent).

Every evidence quote is checked against the notes text first, the same way the
benchmark checks every question: a quote that is not in the documents could never
be scored as found.

    cd api && uv run python -m eval.add_student_questions
"""

from __future__ import annotations

import json

from pypdf import PdfReader

from .corpus import ROOT, squash
from .student_notes import NOTES

Q = ROOT / "questions.json"
TOPIC = "notes"

# (id, category, question, history, evidence groups, reference answer)
SPEC: list[tuple] = [
    ("nd01", "direct", "What problem does FCFS scheduling have?", (), [["convoy effect"]], "The convoy effect: one long job at the front makes all the short ones wait."),
    ("nd02", "direct", "How is turnaround time defined?", (), [["turnaround time = completion - arrival"]], "Completion time minus arrival time."),
    ("nd03", "direct", "What does durability guarantee in ACID?", (), [["once committed, stays committed even after a crash"]], "Once a transaction commits it stays committed even after a crash (via write-ahead logging)."),
    ("nd04", "direct", "What is a phantom read?", (), [["phantom read: re-running a range query returns new rows"]], "Re-running a range query returns new rows."),
    ("nd05", "direct", "What can L1 regularization do that L2 rarely does?", (), [["can make weights exactly 0 so it does feature selection"]], "L1 can make weights exactly 0, so it does feature selection."),
    ("nd06", "direct", "How many folds are usually used in k-fold cross validation?", (), [["usually k = 5 or 10"]], "Usually k = 5 or 10."),
    ("nd07", "direct", "What are the four conditions that must all hold for a deadlock?", (), [["mutual exclusion, hold and wait, no preemption, circular wait"]], "Mutual exclusion, hold and wait, no preemption and circular wait."),
    ("nd08", "direct", "What does BCNF require of every non-trivial functional dependency?", (), [["X must be a superkey"]], "The left side X must be a superkey."),
    ("nr01", "reworded", "Which scheduler minimises the average waiting time, and why can't it be built exactly?", (), [["gives the minimum avg waiting time (provably optimal) but we cant know the next burst length in advance"]], "Shortest job first: it is optimal but the next burst length cannot be known in advance."),
    ("nr02", "reworded", "Why shouldn't the round robin time slice be very small?", (), [["if q too small -> too many context switches"]], "Too many context switches."),
    ("nr03", "reworded", "Which lock modes can be held on the same item at once?", (), [["S is compatible w/ S only"]], "Only shared locks are compatible with each other."),
    ("nr04", "reworded", "Which isolation level does PostgreSQL use by default?", (), [["read committed - no dirty reads (default in postgres)"]], "Read committed."),
    ("nr05", "reworded", "How do bias and variance change as a model becomes more complex?", (), [["more complex model -> bias down, variance up"]], "Bias goes down and variance goes up."),
    ("nr06", "reworded", "Why is accuracy a poor metric when one class dominates the data?", (), [["accuracy is misleading when classes are imbalanced"]], "Accuracy is misleading when classes are imbalanced."),
    ("nr07", "reworded", "How can the dining philosophers avoid deadlock?", (), [["allow at most 4 to sit, or pick up both forks atomically"]], "Allow at most 4 to sit, or pick up both forks atomically."),
    ("ne01", "exact", "What is the average waiting time under FCFS for bursts 24, 3, 3?", (), [["avg wait = 17 ms"]], "17 ms."),
    ("ne02", "exact", "With a quantum of 4 ms, what is the round robin average waiting time for bursts 24, 3, 3?", (), [["avg wait = 5.67 ms"]], "5.67 ms."),
    ("ne03", "exact", "What are Adam's default beta1, beta2 and epsilon?", (), [["beta1 = 0.9, beta2 = 0.999, eps = 1e-8"]], "beta1 = 0.9, beta2 = 0.999, eps = 1e-8."),
    ("ne04", "exact", "What F1 score do TP = 40, FP = 10 and FN = 20 give?", (), [["R = 0.667, F1 = 0.727"]], "About 0.727."),
    ("ne05", "exact", "Which isolation level is the default in MySQL InnoDB?", (), [["repeatable read - no dirty or non-repeatable reads (default in mysql innodb)"]], "Repeatable read."),
    ("ne06", "exact", "What AUC value means a classifier is just guessing?", (), [["0.5 = random guessing"]], "0.5."),
    ("ne07", "exact", "What is the effective access time with a 10 ns TLB, 100 ns memory and an 80% hit ratio?", (), [["EAT = 0.8 * 110 + 0.2 * 210 = 130 ns"]], "130 ns."),
    ("ne08", "exact", "What is the entropy of a node with 9 yes and 5 no examples?", (), [["entropy 0.940 bits"]], "0.940 bits."),
    (
        "nf01", "followup", "And what happens if that quantum is too large?",
        ({"role": "user", "content": "What is round robin?"}, {"role": "assistant", "content": "It gives each process a time quantum and then moves it to the back of the ready queue."}),
        [["if q too large -> becomes FCFS"]], "It becomes FCFS.",
    ),
    (
        "nf02", "followup", "Does it prevent deadlock?",
        ({"role": "user", "content": "What is two phase locking?"}, {"role": "assistant", "content": "A protocol with a growing phase where locks are only acquired and a shrinking phase where they are only released."}),
        [["does NOT prevent deadlock"]], "No, it does not prevent deadlock.",
    ),
    (
        "nf03", "followup", "What is the extreme case where k equals the number of samples?",
        ({"role": "user", "content": "What is k-fold cross validation?"}, {"role": "assistant", "content": "The data is split into k parts, and each part is used once as the test set."}),
        [["LOOCV = k = n"]], "Leave-one-out cross validation, which is very expensive.",
    ),
    (
        "nf04", "followup", "How do they guess the next burst then?",
        ({"role": "user", "content": "What is shortest job first?"}, {"role": "assistant", "content": "It runs the process with the shortest next cpu burst first."}),
        [["exponential averaging"]], "With exponential averaging of past bursts.",
    ),
    (
        "nf05", "followup", "How can the application avoid most of them?",
        ({"role": "user", "content": "What is a deadlock in a database?"}, {"role": "assistant", "content": "Two transactions each wait for a lock the other holds."}),
        [["always lock rows in the same order in every txn"]], "Always lock rows in the same order in every transaction.",
    ),
    ("nc01", "cross", "Which scheduling policies can starve a process, and what is the fix?", (), [["starvation: long jobs may never run if short ones keep coming"], ["aging: slowly raise the priority of procs that keep waiting"]], "SJF and priority scheduling can starve processes; aging fixes priority starvation."),
    ("nc02", "cross", "How do wait-die and wound-wait differ?", (), [["wait-die: older txn waits"], ["wound-wait: older txn wounds"]], "In wait-die the older waits and the younger dies; in wound-wait the older aborts the younger."),
    ("nc03", "cross", "Which techniques are used against overfitting?", (), [["dropout: randomly drop units while training"], ["early stopping: stop when val loss starts going up"]], "Dropout and early stopping (and regularization)."),
    ("nc04", "cross", "How do FIFO and LRU page replacement differ?", (), [["FIFO: replace the oldest page"], ["LRU: replace the least recently used page"]], "FIFO replaces the oldest page and has Belady's anomaly; LRU replaces the least recently used page."),
    ("nu01", "unanswerable", "How does the Linux CFS scheduler pick the next task to run?", (), [], ""),
    ("nu02", "unanswerable", "How does MVCC work in PostgreSQL?", (), [], ""),
    ("nu03", "unanswerable", "How does the attention mechanism in a transformer work?", (), [], ""),
    ("nu04", "unanswerable", "What does the CAP theorem say about distributed databases?", (), [], ""),
    ("nu05", "unanswerable", "How does XGBoost differ from a random forest?", (), [], ""),
]


def notes_text() -> str:
    out = ""
    for name in NOTES:
        out += squash("\n".join(p.extract_text() for p in PdfReader(ROOT / "corpus" / name).pages))
    return out


def main() -> None:
    text = notes_text()
    missing = [(i, g) for i, _c, _q, _h, ev, _a in SPEC for grp in ev for g in grp if squash(g) not in text for _ in [0]]
    # (the comprehension keeps (id, quote) pairs for the message below)
    if missing:
        raise SystemExit("quotes not in the notes:\n" + "\n".join(f"  {i}: {g!r}" for i, g in missing))

    existing = json.loads(Q.read_text(encoding="utf-8"))
    have = {q["id"] for q in existing}
    added = 0
    for idx, (qid, cat, question, history, evidence, answer) in enumerate(SPEC):
        if qid in have:
            continue
        row = {
            "id": qid,
            "topic": TOPIC,
            "category": cat,
            "split": "tune" if idx % 5 in (0, 1, 2) else "test",
            "question": question,
            "evidence": [list(g) for g in evidence],
            "answer": answer,
        }
        if history:
            row["history"] = list(history)
        existing.append(row)
        added += 1
    Q.write_text(json.dumps(existing, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"added {added} questions ({len(existing)} in total)")


if __name__ == "__main__":
    main()
