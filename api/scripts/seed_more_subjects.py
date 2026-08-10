"""Second seed pass: more subjects, and enough real conversation to feed the agents.

Deliberately seeds CHAT ONLY — no notes, no quizzes, no cards.

The point is to test the agents rather than fake their output: with a real
conversation in each topic, `/notes/generate`, `/quizzes/generate` and
`/flashcards/generate` can be called for real and judged on what they produce.
Pre-writing those rows here would prove nothing except that INSERT works.

    uv run python scripts/seed_more_subjects.py > /tmp/seed2.sql
    npx supabase db query -f /tmp/seed2.sql --linked
    uv run python scripts/generate_via_agents.py
"""

from __future__ import annotations

import random
import uuid
from datetime import UTC, datetime, timedelta

USER_ID = "11ce5563-b933-44be-8131-7d7304947d0b"
random.seed(23)


def q(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


NOW = datetime.now(UTC).replace(microsecond=0)


def ts(dt: datetime) -> str:
    return q(dt.astimezone(UTC).isoformat())


out: list[str] = []
w = out.append
w("-- Second seed pass: subjects + topics + chat. Agents fill in the rest.")
w("begin;")
w("")

# (name, tone, pinned, days_ago, [(topic, days_ago_touched)])
SUBJECTS = [
    ("Reinforcement Learning", "coral", True, 28, [
        ("Markov Decision Processes", 0),
        ("Q-Learning", 1),
        ("Policy Gradients", 5),
    ]),
    ("Data Structures", "sun", False, 24, [
        ("Balanced Trees", 2),
        ("Graph Traversal", 4),
    ]),
    ("Computer Networks", "azure", False, 17, [
        ("TCP Congestion Control", 3),
    ]),
]

topic_ids: dict[str, str] = {}
w("-- Subjects and topics")
for name, tone, pinned, made, topics in SUBJECTS:
    sid = str(uuid.uuid4())
    w(
        f"insert into subjects (id, user_id, name, tone, pinned, created_at) values "
        f"({q(sid)}, {q(USER_ID)}, {q(name)}, {q(tone)}, {str(pinned).lower()}, "
        f"{ts(NOW - timedelta(days=made))});"
    )
    for tname, touched in topics:
        tid = str(uuid.uuid4())
        topic_ids[tname] = tid
        w(
            f"insert into subspaces (id, user_id, subject_id, name, created_at, last_activity_at) "
            f"values ({q(tid)}, {q(USER_ID)}, {q(sid)}, {q(tname)}, "
            f"{ts(NOW - timedelta(days=made - 1))}, {ts(NOW - timedelta(days=touched))});"
        )
w("")

# Substantial conversations — the agents are only as good as what they read,
# so these carry real explanations, a wrong turn, and a correction.
CONVERSATIONS: dict[str, list[tuple[str, str]]] = {
    "Markov Decision Processes": [
        ("user", "I keep mixing up the value function and the Q function. What's the actual difference?"),
        ("assistant",
         "V(s) answers 'how good is this state, assuming I then act according to my policy'. "
         "Q(s,a) answers 'how good is taking THIS action from this state, and then following "
         "my policy afterwards'. So Q is one step more specific — it commits to the first "
         "action before handing over to the policy. V(s) is just the Q of whichever action "
         "the policy would pick, averaged if the policy is stochastic."),
        ("user", "So if I have Q I can always get V?"),
        ("assistant",
         "Yes — V(s) = Σ_a π(a|s) Q(s,a), or simply max_a Q(s,a) if the policy is greedy. "
         "The reverse doesn't hold: from V alone you can't recover Q without knowing the "
         "transition model, because you'd need to know where each action leads. That "
         "asymmetry is exactly why model-free control learns Q rather than V — Q is "
         "directly actionable, V isn't."),
        ("user", "What does the discount factor actually do to behaviour?"),
        ("assistant",
         "It sets the agent's horizon. γ=0 makes it purely greedy about immediate reward. "
         "γ→1 makes it patient enough to accept losses now for gains later. Practically "
         "γ also keeps the sum finite in continuing tasks — without it, an infinite stream "
         "of small rewards diverges and every policy looks equally infinite."),
    ],
    "Q-Learning": [
        ("user", "Walk me through why Q-learning converges"),
        ("assistant",
         "Three things have to hold. Every state-action pair keeps getting visited — that's "
         "what exploration buys you. The learning rate decays, but not too fast: the classic "
         "Robbins-Monro conditions, Σα = ∞ and Σα² < ∞. And the Bellman optimality operator "
         "is a γ-contraction, so repeated application pulls any starting estimate toward the "
         "unique fixed point Q*. The first two make the stochastic approximation behave like "
         "the deterministic operator in the limit."),
        ("user", "Is the contraction thing why γ has to be less than 1?"),
        ("assistant",
         "Exactly. The contraction factor IS γ. At γ=1 the operator is non-expansive rather "
         "than contracting, so the fixed-point argument stops working and convergence needs "
         "extra structure — an episodic task with guaranteed termination, typically."),
        ("user", "I thought Q-learning was on-policy because it uses epsilon-greedy"),
        ("assistant",
         "That's the common trap, and worth being precise about. Epsilon-greedy is the "
         "BEHAVIOUR policy — how it picks actions to execute. The update uses max over next "
         "actions, which is the TARGET policy, and that one is greedy. Off-policy means "
         "those two differ. SARSA plugs the actually-taken next action into the update, "
         "which makes behaviour and target the same, hence on-policy."),
    ],
    "Balanced Trees": [
        ("user", "Why do we need AVL trees if we have BSTs?"),
        ("assistant",
         "Because a plain BST has no defence against sorted input. Insert 1..n in order and "
         "every node has one child — you have rebuilt a linked list with extra pointers, and "
         "search degrades from O(log n) to O(n). AVL adds a balance invariant: the heights of "
         "any node's two subtrees differ by at most one, restored by rotations after each "
         "insert or delete. That bounds the height at ~1.44 log n."),
        ("user", "How does a red-black tree compare?"),
        ("assistant",
         "Looser invariant, so it does fewer rotations on write but allows a taller tree — up "
         "to 2 log n. AVL is better when reads dominate, red-black when writes do. It's not "
         "that one is better; they sit at different points on the same trade-off, which is "
         "why std::map uses red-black and most database indexes use B-trees instead."),
    ],
    "Graph Traversal": [
        ("user", "When would I use DFS over BFS?"),
        ("assistant",
         "BFS when you need the shortest path in an unweighted graph, because it explores in "
         "order of distance and the first time it reaches a node is via a shortest path. DFS "
         "when you care about structure rather than distance: cycle detection, topological "
         "sort, finding connected components, or anything where you need to know when a "
         "subtree is fully finished. DFS also uses O(depth) memory instead of O(width), which "
         "matters on wide graphs."),
        ("user", "Does DFS find a path at all, even if not the shortest?"),
        ("assistant",
         "In a finite graph, yes — if a path exists, DFS will find one. Just not necessarily "
         "a short one; it can wander deep down a wrong branch first. In an infinite or very "
         "deep graph it may never come back, which is what iterative deepening fixes."),
    ],
    "TCP Congestion Control": [
        ("user", "What's the difference between congestion control and flow control?"),
        ("assistant",
         "Flow control protects the RECEIVER — the receive window stops a fast sender from "
         "overrunning a slow reader's buffer. Congestion control protects the NETWORK — the "
         "congestion window stops senders collectively overrunning the routers between them. "
         "TCP sends the minimum of the two windows, so whichever constraint binds first is "
         "the one that limits you."),
        ("user", "Why does TCP treat packet loss as congestion?"),
        ("assistant",
         "It's an inference, and one that was accurate when TCP was designed: on wired links "
         "loss almost always meant a router queue overflowed. It ages badly on wireless, "
         "where loss is often corruption rather than congestion, so TCP backs off when it "
         "should just retransmit. That mismatch is the whole reason for BBR, which models "
         "bandwidth and RTT directly instead of using loss as a proxy."),
    ],
}

w("-- Chat")
for topic, turns in CONVERSATIONS.items():
    tid = topic_ids[topic]
    base = NOW - timedelta(days=random.randint(1, 7), hours=random.randint(0, 9))
    for i, (role, content) in enumerate(turns):
        w(
            f"insert into chat_messages (user_id, subspace_id, role, content, created_at) "
            f"values ({q(USER_ID)}, {q(tid)}, {q(role)}, {q(content)}, "
            f"{ts(base + timedelta(minutes=3 * i))});"
        )

w("")
w("commit;")
print("\n".join(out))
