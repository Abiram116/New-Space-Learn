"""System-design evaluation: what the machinery around the model costs and guarantees.

No model calls, no network: it runs in seconds and can run on every change.

    uv run python -m eval.system

Writes `eval/results/system.json`; `eval/REPORT.md` shows it. Sections:

1. **Prompt size** — the chat prompt, piece by piece, for a plain question and for
   one with a shape. Where the tokens go.
2. **Conversation budget** — how big the history sent back to the model gets as a
   conversation grows, with and without the budget (`services/context_budget.py`).
3. **Caches** — that each cache hits when it should, and never when it must not
   (a regenerate, other sources, another student, a follow-up).
4. **Model tiers** — which code uses which model, read from the source.
5. **Retrieval speed** — from the last benchmark run, on this machine.
6. **Invariants** — the whole backend test suite, which holds the rules that keep
   answers honest and the service up (rate limits, fallbacks, guardrails).

Token counts are characters ÷ 4, the usual rule of thumb for English: good for
comparing one design with another, not an invoice. Real counts per task come from
`services/usage.py` on a running server.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from app.services import answer_cache, context_budget, guardrails, rag, voice
from app.services import followup as followup_mod

ROOT = Path(__file__).resolve().parent
API = ROOT.parent
RESULTS = ROOT / "results"


def tok(chars: int) -> int:
    return round(chars / 4)


# ── 1. prompt size ──────────────────────────────────────────────────────


def prompt_size() -> dict:
    src = [
        rag.Retrieved(document_id="d", document_name="Notes.pdf", content="Lorem ipsum dolor sit amet. " * 28, locator=f"p. {i}", similarity=0.9)
        for i in range(6)
    ]

    def build(question: str, history: list[dict] | None = None) -> list[dict]:
        messages, _ = rag.build_prompt(
            subspace_name="Operating Systems",
            active_skill_instructions=[],
            history=history or [],
            question=question,
            retrieved=src,
            answer_only_from_docs=True,
            always_show_citations=True,
            suggest_followup=True,
        )
        return messages

    pieces = {
        "voice": voice.COMPANION_VOICE,
        "answer shape (full)": voice.RESPONSE_SHAPE,
        "answer shape (short)": voice.SHAPE_SHORT,
        "diagram rule (full)": voice.DIAGRAM_RULE,
        "diagram rule (short)": voice.DIAGRAM_SHORT,
        "safety rules": guardrails.SAFETY_RULES,
        "honesty rules": guardrails.integrity_rules(grounded=True, cite=True),
        "follow-up suggestion": followup_mod.PROMPT,
    }
    rows = {k: tok(len(v)) for k, v in pieces.items()}
    out = {"pieces": rows, "totals": {}}
    for label, q in {
        "plain question (\"What is a page fault?\")": "What is a page fault?",
        "question with a shape (\"Explain how paging works\")": "Explain how paging works",
    }.items():
        m = build(q)
        out["totals"][label] = {
            "instructions": tok(len(m[0]["content"])),
            "sources": tok(len(m[1]["content"])) if len(m) > 2 else 0,
            "total": tok(sum(len(x["content"]) for x in m)),
        }
    return out


# ── 2. conversation budget ──────────────────────────────────────────────


def conversation_budget() -> list[dict]:
    answer = "Paging moves fixed-size blocks between memory and disk [[1]]. " * 30  # ≈1,800 characters
    rows = []
    for turns in (2, 4, 8, 20, 40):
        history = []
        for i in range(turns):
            history.append({"role": "user" if i % 2 == 0 else "assistant", "content": "What about paging in case " + str(i) + "?" if i % 2 == 0 else answer})
        before = sum(len(m["content"]) for m in history)
        after = sum(len(m["content"]) for m in context_budget.fit_history(history))
        rows.append({"messages": turns, "before_tokens": tok(before), "after_tokens": tok(after), "saved": f"{1 - after / before:.0%}" if before else "0%"})
    return rows


# ── 3. caches ───────────────────────────────────────────────────────────


def caches() -> list[dict]:
    answer_cache.clear()
    vec = [0.1, 0.2, 0.3, 0.4]
    fp = answer_cache.fingerprint(chunk_ids=["c1"], flags={"cite": True})
    answer_cache.store("u", "s", "What is thrashing?", vec, fp, "Paging too much.", None)

    def case(name: str, expect_hit: bool, got) -> dict:
        return {"case": name, "should_hit": expect_hit, "hit": got is not None, "ok": (got is not None) == expect_hit}

    other_src = answer_cache.fingerprint(chunk_ids=["c1", "c2"], flags={"cite": True})
    other_set = answer_cache.fingerprint(chunk_ids=["c1"], flags={"cite": False})
    return [
        case("same question", True, answer_cache.lookup("u", "s", "What is thrashing?", vec, fp)),
        case("same words, different case and punctuation", True, answer_cache.lookup("u", "s", "what is thrashing", [9, 9, 9, 9], fp)),
        case("a near-identical vector", True, answer_cache.lookup("u", "s", "Whats thrashing exactly", [0.1, 0.2, 0.3, 0.41], fp)),
        case("an unrelated question", False, answer_cache.lookup("u", "s", "What is a page fault?", [0.4, -0.3, 0.2, -0.1], fp)),
        case("the sources changed (a file was edited or removed)", False, answer_cache.lookup("u", "s", "What is thrashing?", vec, other_src)),
        case("a setting changed (citations off)", False, answer_cache.lookup("u", "s", "What is thrashing?", vec, other_set)),
        case("another student, same question", False, answer_cache.lookup("other", "s", "What is thrashing?", vec, fp)),
        case("another topic, same question", False, answer_cache.lookup("u", "other", "What is thrashing?", vec, fp)),
    ]


# ── 4. model tiers ──────────────────────────────────────────────────────

_MODEL = {"groq_model_fast": "small (20B)", "groq_model_vision": "vision", "groq_model": "large (120B)"}


def tiers() -> list[dict]:
    rows = []
    for path in sorted((API / "app").rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        tasks = sorted(set(re.findall(r'usage\.task\(\s*"([\w.]+)"', text)))
        models = sorted({_MODEL[m] for m in re.findall(r"\b(?:settings|cfg)\.(groq_model_fast|groq_model_vision|groq_model)\b", text)})
        if tasks or models:
            rows.append({"file": str(path.relative_to(API)), "tasks": tasks, "models": models})
    return rows


# ── 5. retrieval speed ──────────────────────────────────────────────────


def retrieval_speed() -> dict | None:
    saved = RESULTS / "v2-5-judge.json"
    if not saved.exists():
        return None
    data = json.loads(saved.read_text())
    ms = sorted(r["ms"] for r in data["rows"] if "ms" in r)
    if not ms:
        return None
    return {
        "variant": data["variant"],
        "ran_at": data["ran_at"],
        "questions": len(ms),
        "p50_ms": ms[len(ms) // 2],
        "p95_ms": ms[int(len(ms) * 0.95) - 1],
        "embed_ms_one_question": data.get("embed_ms"),
        "note": "On this machine. Production is a tenth of a CPU, so compare variants with each other, not with Render.",
    }



# ── 5b. speed of our own code ───────────────────────────────────────────


def own_code_speed() -> dict:
    """How long the parts that are ours take, with no network: building a prompt for a
    long conversation, and looking an answer up in the cache. Small, and worth knowing
    is small: it means all the waiting is the model and the database."""
    import time

    src = [rag.Retrieved(document_id="d", document_name="Notes.pdf", content="Lorem ipsum. " * 70, locator=f"p. {i}", similarity=0.9) for i in range(6)]
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": "x" * 1500} for i in range(40)]

    def mean_ms(fn, runs: int) -> float:
        t = time.perf_counter()
        for _ in range(runs):
            fn()
        return round((time.perf_counter() - t) / runs * 1000, 3)

    def build() -> None:
        rag.build_prompt(subspace_name="OS", active_skill_instructions=[], history=context_budget.fit_history(history), question="Explain paging", retrieved=src, answer_only_from_docs=True, always_show_citations=True, suggest_followup=True)

    answer_cache.clear()
    fp = answer_cache.fingerprint(chunk_ids=["c"], flags={})
    for i in range(12):
        answer_cache.store("u", "s", f"question {i}", [0.1 * i, 0.2, 0.3, 0.4], fp, "answer", None)
    return {
        "build_prompt_40_message_chat_ms": mean_ms(build, 200),
        "cache_lookup_12_entries_ms": mean_ms(lambda: answer_cache.lookup("u", "s", "never asked", [0.9, 0.1, 0.1, 0.1], fp), 2000),
    }


# ── 5c. capacity: how many answers the free tier allows ─────────────────

#: Groq's free-tier limits for each model, read from its 429 messages (2026-10-04).
TPM = 8_000
TPD = 200_000


def capacity(turn_tokens: dict[str, int], replies: tuple[int, int] = (300, 800)) -> list[dict]:
    """Answers per minute and per day the whole app can serve, before it has to fall back.

    The limit is on the ORGANISATION's key, not per student: every student shares it.
    A turn costs its prompt plus its reply, and the reply counts against the limit. Real
    replies run from a few sentences to a long explanation, so this gives the range for
    300 to 800 reply tokens rather than one number that pretends to be exact.
    """
    rows = []
    for name, prompt in turn_tokens.items():
        lo, hi = (prompt + replies[0]), (prompt + replies[1])
        rows.append({"turn": name, "tokens_per_answer": f"{lo}–{hi}", "answers_per_minute": f"{TPM / hi:.1f}–{TPM / lo:.1f}", "answers_per_day": f"{TPD // hi}–{TPD // lo}"})
    return rows


# ── 5d. real latency, against the real model (uses the Groq key) ────────


def live_latency(runs: int = 4) -> dict:
    """Time to the first word, time to the whole answer, and what a turn really costs.

    Sequential, then three at once. Uses a small share of the key's allowance
    (about 3,000 tokens a call). Run with `--live`.
    """
    import asyncio
    import time

    import httpx

    from app.config import settings

    src = [rag.Retrieved(document_id="d", document_name="Notes.pdf", content=("Paging divides memory into fixed-size frames and pages. " * 22), locator=f"p. {i}", similarity=0.9) for i in range(6)]
    questions = ["What is a page fault?", "Explain how paging works", "Why does thrashing happen?", "What is a TLB?"]

    async def one(model: str, question: str) -> dict:
        messages, _ = rag.build_prompt(subspace_name="Operating Systems", active_skill_instructions=[], history=[], question=question, retrieved=src, answer_only_from_docs=True, always_show_citations=True, suggest_followup=True)
        body = {"model": model, "messages": messages, "stream": True, "stream_options": {"include_usage": True}, "max_completion_tokens": settings.groq_max_completion_tokens, "temperature": 0.4}
        if "gpt-oss" in model:
            body |= {"reasoning_effort": settings.groq_reasoning_effort, "include_reasoning": False}
        start = time.perf_counter()
        first = None
        usage: dict = {}
        async with httpx.AsyncClient(timeout=90) as client, client.stream("POST", f"{settings.groq_base_url}/chat/completions", json=body, headers={"Authorization": f"Bearer {settings.groq_api_key}"}) as r:
            if r.status_code != 200:
                return {"error": f"{r.status_code}"}
            async for line in r.aiter_lines():
                if not line.startswith("data:") or line.endswith("[DONE]"):
                    continue
                chunk = json.loads(line[5:])
                delta = ((chunk.get("choices") or [{}])[0].get("delta") or {}).get("content")
                if delta and first is None:
                    first = time.perf_counter() - start
                usage = chunk.get("x_groq", {}).get("usage") or chunk.get("usage") or usage
        total = time.perf_counter() - start
        return {"ttft_s": round(first or total, 2), "total_s": round(total, 2), "prompt_tokens": usage.get("prompt_tokens"), "reply_tokens": usage.get("completion_tokens")}

    def stats(rows: list[dict]) -> dict:
        ok = [r for r in rows if "error" not in r]
        if not ok:
            return {"ok": 0, "errors": [r.get("error") for r in rows]}
        med = lambda k: sorted(r[k] for r in ok)[len(ok) // 2]  # noqa: E731
        return {"ok": len(ok), "of": len(rows), "median_ttft_s": med("ttft_s"), "median_total_s": med("total_s"), "median_prompt_tokens": med("prompt_tokens"), "median_reply_tokens": med("reply_tokens")}

    async def go() -> dict:
        out: dict = {}
        for model in (settings.groq_model, settings.groq_model_fast):
            seq = [await one(model, questions[i % len(questions)]) for i in range(runs)]
            await asyncio.sleep(20)
            t = time.perf_counter()
            par = await asyncio.gather(*[one(model, questions[i % len(questions)]) for i in range(3)])
            wall = round(time.perf_counter() - t, 2)
            out[model] = {"one_at_a_time": stats(seq), "three_at_once": {**stats(list(par)), "wall_s": wall}}
            await asyncio.sleep(30)
        return out

    return asyncio.run(go())


# ── 6. invariants ───────────────────────────────────────────────────────


def invariants() -> dict:
    run = subprocess.run([sys.executable, "-m", "pytest", "-q", "-x", "--no-header", "-p", "no:cacheprovider"], cwd=API, capture_output=True, text=True, timeout=900)
    last = (run.stdout.strip().splitlines() or [""])[-1]
    return {"passed": run.returncode == 0, "summary": last}


# ── report ──────────────────────────────────────────────────────────────


def render(d: dict) -> str:
    L = ["# System-design evaluation", "", f"Rebuilt by `python -m eval.system` on {d['ran_at'][:10]}. No model calls. Tokens are characters ÷ 4.", ""]
    L += ["## 1. Where the prompt's tokens go", "", "| Piece | Tokens |", "|---|---|"]
    L += [f"| {k} | {v} |" for k, v in d["prompt"]["pieces"].items()]
    L += ["", "| A chat turn with six sources | Instructions | Sources | Total (no history) |", "|---|---|---|---|"]
    L += [f"| {k} | {v['instructions']} | {v['sources']} | {v['total']} |" for k, v in d["prompt"]["totals"].items()]
    L += ["", "The short answer shape and short diagram line are what a plainly simple question gets; the full ones are for questions that want structure.", ""]
    L += ["## 2. History sent back to the model", "", "| Messages in the chat | Before the budget | After | Saved |", "|---|---|---|---|"]
    L += [f"| {r['messages']} | {r['before_tokens']} | {r['after_tokens']} | {r['saved']} |" for r in d["budget"]]
    L += ["", f"The free tier allows about 8,000 tokens a minute on the large model. The budget's ceiling is {tok(context_budget.MAX_CHARS)} tokens however many turns a Skill asks for.", ""]
    L += ["## 3. Caches: hit when they should, never when they must not", "", "| Case | Should hit | Hit | |", "|---|---|---|---|"]
    L += [f"| {c['case']} | {c['should_hit']} | {c['hit']} | {'ok' if c['ok'] else '**WRONG**'} |" for c in d["caches"]]
    L += ["", "Also covered by tests, not here: a regenerate is never served from the cache; a follow-up is never cached; an image is never cached.", ""]
    L += ["## 4. Which model does what (read from the source)", "", "| File | Tasks | Models referenced |", "|---|---|---|"]
    L += [f"| `{t['file']}` | {', '.join(t['tasks']) or '—'} | {', '.join(t['models']) or '—'} |" for t in d["tiers"]]
    L += ["", "A scan, not a trace: a file that names two models may use each for a different call. A call that names no model (the chat answer) uses the large one and falls back to the small one if it is unavailable (`services/llm.py`).", ""]
    if d["retrieval_speed"]:
        s = d["retrieval_speed"]
        L += ["## 5. Retrieval speed", "", f"`{s['variant']}` over {s['questions']} questions: median {s['p50_ms']} ms, 95th percentile {s['p95_ms']} ms; embedding one question {s['embed_ms_one_question']} ms. {s['note']}", ""]
    o = d.get("own_code_ms")
    if o:
        L += ["### Our own code", "", f"Building the prompt for a 40-message conversation: {o['build_prompt_40_message_chat_ms']} ms. Looking an answer up in the cache: {o['cache_lookup_12_entries_ms']} ms. Everything slow is the model and the database, not this code.", ""]
    cap = d.get("capacity")
    if cap:
        L += ["### How many answers the free tier allows, for everyone together", "", f"The limit is on the app's one key, shared by every student: {cap['tpm']:,} tokens a minute and {cap['tpd']:,} a day per model. A turn costs its prompt plus its reply, and replies run from about 300 to 800 tokens, so each cell is a range.", "", "| A turn like | Tokens | Answers per minute | Answers per day |", "|---|---|---|---|"]
        L += [f"| {r['turn']} | {r['tokens_per_answer']} | {r['answers_per_minute']} | {r['answers_per_day']} |" for r in cap["rows"]]
        L += ["", "When the large model is out, the app falls back to the small one, which has its own allowance, so the real ceiling is higher; the cache and the smaller prompts are what raise it further.", ""]
    if d.get("live"):
        L += ["### Real model latency", "", "| Model | Way | Worked | Median to first word | Median to whole answer | Prompt tokens | Reply tokens |", "|---|---|---|---|---|---|---|"]
        for model, v in d["live"].items():
            for way, label in (("one_at_a_time", "one at a time"), ("three_at_once", "three at once")):
                r = v[way]
                if r.get("ok"):
                    extra = f" (all three took {r['wall_s']} s)" if way == "three_at_once" else ""
                    L.append(f"| `{model}` | {label}{extra} | {r['ok']} of {r['of']} | {r['median_ttft_s']} s | {r['median_total_s']} s | {r['median_prompt_tokens']} | {r['median_reply_tokens']} |")
                else:
                    why = "refused: the daily allowance was spent. Re-run `--live` after it frees up" if set(r.get("errors") or []) == {"429"} else r.get("errors")
                    L.append(f"| `{model}` | {label} | 0 | {why} | | | |")
        L += ["", "Measured from this machine to Groq, not from a student's browser through Render.", ""]
    L += ["## 6. Invariants (the backend test suite)", "", f"{'PASS' if d['invariants']['passed'] else '**FAIL**'}: {d['invariants']['summary']}", ""]
    return "\n".join(L)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="also time the real model (uses the Groq key)")
    args = parser.parse_args()
    prior = json.loads((RESULTS / "system.json").read_text()) if (RESULTS / "system.json").exists() else {}
    prompt = prompt_size()
    live = live_latency() if args.live else prior.get("live")
    turns = {k: v["total"] for k, v in prompt["totals"].items()}
    data = {
        "ran_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "prompt": prompt,
        "budget": conversation_budget(),
        "caches": caches(),
        "tiers": tiers(),
        "retrieval_speed": retrieval_speed(),
        "own_code_ms": own_code_speed(),
        "capacity": {"tpm": TPM, "tpd": TPD, "rows": capacity(turns)},
        "live": live,
        "invariants": invariants(),
    }
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "system.json").write_text(json.dumps(data, indent=1))
    bad = [c["case"] for c in data["caches"] if not c["ok"]]
    print(f"wrote {RESULTS / 'system.json'}")
    print("cache cases wrong:", bad or "none", "| invariants:", data["invariants"]["summary"])


if __name__ == "__main__":
    main()
