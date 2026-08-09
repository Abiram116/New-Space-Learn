"""Synthetic supplementary evaluation set for the embedding benchmark.

Why this exists: the live product database has exactly one uploaded document
(stuck mid-processing, never chunked) and zero rows in `document_chunks`. Two
existing quizzes have a `source` field, but it holds a topic label
("General Knowledge"), not a real page/chunk locator — they were generated
without retrieval grounding, so they can't serve as ground truth for "did
retrieval find the right passage."

This means there is currently no real corpus large enough for Recall@5/
Recall@10/MRR to mean anything statistically. Rather than fabricate false
precision from N=1 document, this file is an honestly-labeled SYNTHETIC
corpus — short, distinct study passages across several subjects, each with
a query whose answer is only in one passage — sized so Recall@K has a
denominator worth reporting. The real document supplements it separately;
see bench_embeddings.py, which loads both and reports them apart, never
blended into one misleading number.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EvalItem:
    query: str
    # Index into PASSAGES this query's answer actually lives in.
    gold_index: int


# 24 short passages, 8 subjects, 3 passages each — distinct enough that a
# model with no real understanding (e.g. bag-of-words overlap alone) would
# still do only moderately, so this isn't trivially gameable.
PASSAGES: list[str] = [
    # Reinforcement learning
    "A Markov decision process is defined by a set of states, a set of actions, a transition function, and a reward function. The Markov property means the next state depends only on the current state and action, not on the full history.",
    "Q-learning is an off-policy temporal-difference algorithm. It updates the action-value estimate Q(s,a) toward the observed reward plus the discounted maximum Q-value of the next state, regardless of the policy actually followed.",
    "Policy gradient methods optimize the policy directly by ascending the gradient of expected return with respect to the policy parameters, rather than first learning a value function and deriving a policy from it.",
    # Databases
    "A database index speeds up lookups by maintaining a sorted structure, typically a B-tree, that lets the engine locate matching rows without scanning every row in the table.",
    "Normalization reduces redundancy by splitting a table into smaller related tables. Third normal form requires every non-key column to depend only on the primary key, not on other non-key columns.",
    "A deadlock occurs when two transactions each hold a lock the other needs, and both wait indefinitely. Most database engines detect this and abort one of the transactions to break the cycle.",
    # Biology
    "The descending limb of the loop of Henle is permeable to water but not to salt, so fluid grows more concentrated as it descends into the medulla's high-salt environment.",
    "Mitochondria generate ATP through oxidative phosphorylation, using an electron transport chain across the inner membrane to build a proton gradient that drives ATP synthase.",
    "Natural selection acts on heritable variation within a population; traits that improve survival or reproduction become more common across generations, without any change to an individual organism during its own lifetime.",
    # Economics
    "A price ceiling set below the market equilibrium price causes quantity demanded to exceed quantity supplied, producing a persistent shortage that the price mechanism can no longer clear.",
    "Comparative advantage means a country should specialize in producing goods where its opportunity cost is lowest, even if another country is more efficient at producing everything.",
    "Inflation erodes the real value of fixed nominal payments over time, which is why long-term contracts sometimes index payments to a price level rather than fixing a nominal amount.",
    # Computer science / hashing
    "A hash collision happens when two distinct keys map to the same bucket index. Open addressing resolves this by probing for the next free slot, while chaining stores a linked list per bucket.",
    "A hash table's average lookup time is O(1) only when the load factor stays low; as it approaches 1, more probes or a longer chain are needed per lookup, degrading toward O(n).",
    "Cryptographic hash functions must be collision-resistant, meaning it should be computationally infeasible to find two different inputs producing the same output, unlike a general-purpose hash table's hash function.",
    # History
    "Margin buying let investors purchase stock with borrowed money, amplifying gains during the 1920s boom but forcing rapid, cascading sales when prices fell and lenders issued margin calls.",
    "The Federal Reserve raised interest rates in 1928 and 1929 to curb speculative lending, tightening credit into an economy that was already slowing in agriculture and manufacturing.",
    "Marbury v. Madison established the principle of judicial review, giving the Supreme Court the authority to strike down a law it finds unconstitutional.",
    # Chemistry
    "In an SN2 reaction, the nucleophile attacks the electrophilic carbon from the side opposite the leaving group, inverting the stereochemistry at that carbon in a single concerted step.",
    "Le Chatelier's principle predicts that a system at equilibrium shifts to counteract an imposed change — increasing reactant concentration shifts the equilibrium toward products.",
    "A buffer solution resists changes in pH because it contains a weak acid and its conjugate base, which can neutralize small additions of either strong acid or strong base.",
    # Statistics
    "A Type I error is rejecting a true null hypothesis — a false positive. A Type II error is failing to reject a false null hypothesis — a false negative.",
    "The central limit theorem states that the sampling distribution of the mean approaches a normal distribution as sample size grows, regardless of the shape of the underlying population distribution.",
    "A p-value is the probability of observing a result at least as extreme as the one measured, assuming the null hypothesis is true — it is not the probability the null hypothesis itself is true.",
]

EVAL_SET: list[EvalItem] = [
    EvalItem("What does the Markov property mean in an MDP?", 0),
    EvalItem("How does Q-learning update its value estimate?", 1),
    EvalItem("What do policy gradient methods optimize directly?", 2),
    EvalItem("What data structure do database indexes typically use?", 3),
    EvalItem("What does third normal form require of non-key columns?", 4),
    EvalItem("How do database engines resolve a deadlock?", 5),
    EvalItem("Why does fluid in the descending limb get more concentrated?", 6),
    EvalItem("How do mitochondria produce ATP?", 7),
    EvalItem("Does an individual organism change due to natural selection?", 8),
    EvalItem("What happens when a price ceiling is set below equilibrium?", 9),
    EvalItem("What should a country specialize in under comparative advantage?", 10),
    EvalItem("Why do long-term contracts sometimes index payments to a price level?", 11),
    EvalItem("What is a hash collision?", 12),
    EvalItem("What happens to hash table lookup time as load factor approaches 1?", 13),
    EvalItem("What property must a cryptographic hash function have that a regular one doesn't?", 14),
    EvalItem("What role did margin buying play in the 1929 crash?", 15),
    EvalItem("Why did the Federal Reserve raise rates in 1928-1929?", 16),
    EvalItem("What did Marbury v. Madison establish?", 17),
    EvalItem("What happens to stereochemistry in an SN2 reaction?", 18),
    EvalItem("What does Le Chatelier's principle predict?", 19),
    EvalItem("Why does a buffer solution resist pH changes?", 20),
    EvalItem("What is the difference between a Type I and Type II error?", 21),
    EvalItem("What does the central limit theorem say about the sampling distribution?", 22),
    EvalItem("What does a p-value actually represent?", 23),
]

assert len(EVAL_SET) == 24
assert all(0 <= e.gold_index < len(PASSAGES) for e in EVAL_SET)
