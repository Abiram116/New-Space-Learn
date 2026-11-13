"""Routing and free-tier capacity: which model each task uses, what a call costs, and
how many of them the free tier allows. No model calls unless `--probe`.

    uv run python -m eval.routing            # free: table, call-site check, prompt sizes, capacity
    uv run python -m eval.routing --probe    # + one tiny call on the small model (see `probe`)

Writes `eval/results/routing.json`; `eval/REPORT.md` shows it (`python -m eval.report`).

1. **The routing table** — `ROUTES` in `services/llm.py`, as the code holds it: model,
   reply cap, what happens on failure and when a model's day is nearly spent.
2. **Call sites agree with it** — every `usage.task(...)`/`usage.tagged(...)` in `app/`
   is read, with the model named right after it, and checked against its route: a task
   with no route, a route with no call site, or a call site naming another model is a
   finding.
3. **Prompt size per task** — each prompt built by the production code itself from
   synthetic material at the sizes production allows (six sources for chat, the
   planner's 6,500-character budget for quizzes and decks, the memory fold's 40
   messages). Brief and notes build their prompts inside request handlers, so they are
   not measured here.
4. **Capacity** — calls per minute and per day each task allows on the free tier, and
   whether one call fits a minute's allowance even if Groq were to count the whole
   reply cap against it (the probe says whether it does).

Tokens are characters ÷ 4 (`context_budget.estimate_tokens`). Reply sizes are the
routes' planning figures, not measurements: real ones come from `services/usage.py`
on a running server (the admin page).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from app.config import settings
from app.services import card_writer, chat_memory, coverage, quiz_agent, rag, starters
from app.services import query_resolver as resolver
from app.services.context_budget import MAX_CHARS, estimate_tokens, fit_history
from app.services.coverage import Source
from app.services.llm import ROUTES, _reply_budget, tier_model
from app.services.voice import CARDS_AGENT_VOICE, QUIZ_AGENT_VOICE

ROOT = Path(__file__).resolve().parent
API = ROOT.parent
RESULTS = ROOT / "results"

_TIER = {"groq_model_fast": "fast", "groq_model_vision": "vision", "groq_model": "large"}


# ── 1. the table ─────────────────────────────────────────────────────────


def table() -> list[dict]:
    rows = []
    for task, r in ROUTES.items():
        if r.tier == "vision":
            on_failure = "none: only the vision model can see the image"
        elif not r.fallback:
            on_failure = "none: its caller has a model-free answer"
        elif r.tier == "large":
            on_failure = "small model (logged as a warning)"
        else:
            on_failure = "large model, unless the large model's day is nearly spent"
        when_spent = []
        if r.degrade_early:
            when_spent.append(f"to the small model at {settings.groq_switch_at:.0%} of the large model's day")
        if r.optional:
            when_spent.append(f"skipped at {settings.groq_shed_at:.0%} of its model's day")
        rows.append({
            "task": task,
            "tier": r.tier,
            "model": tier_model(r.tier),
            "max_tokens": _reply_budget(tier_model(r.tier), task)["max_completion_tokens"],
            "reply_planning": r.reply_tokens,
            "on_failure": on_failure,
            "day_nearly_spent": "; ".join(when_spent) or "—",
            "why": r.why,
        })
    return rows


# ── 2. call sites ────────────────────────────────────────────────────────

_TAG = re.compile(r'usage\.(?:task|tagged)\(\s*"([\w.]+)"')
_MODEL_REF = re.compile(r"\b(?:settings|cfg)\.(groq_model_fast|groq_model_vision|groq_model)\b")
_MODEL_ARG = re.compile(r"\bmodel=([a-z_][\w]*)\b")


def call_sites() -> dict:
    """Each tagged call, the model named in the lines after its tag (up to the next tag)."""
    sites = []
    for path in sorted((API / "app").rglob("*.py")):
        if path.name in ("usage.py", "llm.py"):
            continue
        text = path.read_text(encoding="utf-8")
        tags = list(_TAG.finditer(text))
        for i, m in enumerate(tags):
            end = tags[i + 1].start() if i + 1 < len(tags) else len(text)
            window = text[m.end(): min(end, m.end() + 2500)]
            tiers = sorted({_TIER[t] for t in _MODEL_REF.findall(window)})
            runtime = sorted({v for v in _MODEL_ARG.findall(window) if v not in ("model",)})
            sites.append({"file": str(path.relative_to(API)), "task": m.group(1), "tiers": tiers, "runtime": runtime})
    findings = []
    for s in sites:
        route = ROUTES.get(s["task"])
        if route is None:
            findings.append(f"`{s['task']}` ({s['file']}) has no route: it gets the default (large model, 4,096-token cap)")
        elif s["tiers"] and route.tier not in s["tiers"]:
            findings.append(f"`{s['task']}` ({s['file']}) names {', '.join(s['tiers'])}; its route says {route.tier}")
    tagged = {s["task"] for s in sites}
    findings += [f"route `{t}` has no call site tagged with it" for t in ROUTES if t not in tagged]
    return {"sites": sites, "findings": findings}


# ── 3. prompt size per task ──────────────────────────────────────────────

_SENTENCE = "Paging divides memory into fixed-size frames, and the page table maps each page to a frame. "


def _text(chars: int) -> str:
    return (_SENTENCE * (chars // len(_SENTENCE) + 1))[:chars]


def _sources(total_chars: int, n: int) -> list[Source]:
    return [Source(i + 1, f"c{i}", "Notes.pdf", f"p. {i + 1}", _text(total_chars // n)) for i in range(n)]


class _Capture:
    """Stands in for the model: keeps the messages, answers nothing."""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def stream_chat(self, messages, **_):  # noqa: ANN001, ANN003
        self.messages = messages
        return
        yield  # an async generator that yields nothing


def _chat(question: str, *, history_chars: int = 0, summary: str = "", small_talk: bool = False) -> list[dict]:
    src = [rag.Retrieved(document_id="d", document_name="Notes.pdf", content="Lorem ipsum dolor sit amet. " * 28, locator=f"p. {i}", similarity=0.9) for i in range(6)]
    history = []
    while sum(len(m["content"]) for m in history) < history_chars:
        history += [{"role": "user", "content": _text(200)}, {"role": "assistant", "content": _text(1600)}]
    history = fit_history(history, max_chars=history_chars) if history else []  # as the chat route sends it
    messages, _ = rag.build_prompt(
        subspace_name="Operating Systems", active_skill_instructions=[], history=history, question=question,
        retrieved=[] if small_talk else src, answer_only_from_docs=True, always_show_citations=True,
        memory_summary=summary, suggest_followup=True, small_talk=small_talk,
    )
    return messages


def prompt_sizes() -> list[dict]:
    rows: list[dict] = []

    def add(task: str, case: str, messages: list[dict]) -> None:
        rows.append({"task": task, "case": case, "prompt_tokens": estimate_tokens(messages)})

    add("chat", "plain question, six sources, no history", _chat("What is a page fault?"))
    add("chat", "shaped question, six sources, no history", _chat("Explain how paging works step by step"))
    add("chat", "shaped question, history at the budget ceiling, memory summary", _chat("Explain how paging works step by step", history_chars=MAX_CHARS, summary=_text(800)))
    add("chat.smalltalk", "a greeting", _chat("hi there!", small_talk=True))

    prompt = resolver._PROMPT.format(topic="Operating Systems", previous=_text(300), answer=_text(resolver.ANSWER_CHARS), question="and why does that happen?")  # noqa: SLF001
    add("chat.resolve", "largest: previous question 300 chars, answer 500", [{"role": "user", "content": prompt}])

    headings = "\n".join(f"- Section heading number {i}" for i in range(starters.MAX_SECTIONS))
    excerpts = "\n".join(f"- Heading {i}: {_text(starters.EXCERPT_CHARS)}" for i in range(starters.EXCERPTS))
    add("chat.starters", "12 headings, 5 excerpts", [{"role": "user", "content": starters._PROMPT.format(count=starters.COUNT, headings=headings, excerpts=excerpts)}])  # noqa: SLF001

    cap = _Capture()
    original = chat_memory.get_llm
    chat_memory.get_llm = lambda: cap  # type: ignore[assignment]
    try:
        transcript = "\n".join(f"{'user' if i % 2 == 0 else 'assistant'}: {_text(chat_memory._MESSAGE_CHAR_CAP)}" for i in range(chat_memory._MAX_INPUT_MESSAGES))  # noqa: SLF001
        asyncio.run(chat_memory._summarize(_text(800), transcript))  # noqa: SLF001
    finally:
        chat_memory.get_llm = original  # type: ignore[assignment]
    add("chat.memory", "largest fold: 40 messages at 600 chars, prior summary", cap.messages)

    material = _sources(coverage.BUDGET_CHARS, coverage.MAX_SOURCES)
    mix = {"easy": 5, "medium": 7, "hard": 5}
    earlier = [{"q": _text(120)} for _ in range(quiz_agent.SHOW_EARLIER)]
    write = [{"role": "system", "content": QUIZ_AGENT_VOICE}, {"role": "user", "content": quiz_agent.write_prompt(count=quiz_agent.WRITE_MAX, topic="Paging", label="Operating Systems", mix=mix, items=material, earlier=earlier)}]
    add("quiz.write", "15 questions from the planner's full budget (8 sources, 6,500 chars), 12 earlier", write)
    add("quiz.repair", "same prompt, fewer questions asked", write)
    questions = [{"q": _text(110), "choices": [_text(40)] * 4, "answer_index": 0, "source": 1 + i % 8} for i in range(quiz_agent.WRITE_MAX)]
    add("quiz.verify", "15 questions against the same material", [{"role": "user", "content": quiz_agent.verify_prompt(material, questions)}])

    cards_earlier = [{"front": _text(100)} for _ in range(card_writer.SHOW_EARLIER)]
    deck = [{"role": "system", "content": CARDS_AGENT_VOICE}, {"role": "user", "content": card_writer.write_prompt(count=20 + card_writer.SPARE, topic="Paging", label="Operating Systems", items=material, earlier=cards_earlier)}]
    add("cards.write", "22 cards from the planner's full budget, 15 earlier", deck)
    return rows


# ── 4. capacity ──────────────────────────────────────────────────────────


def capacity(sizes: list[dict], rpd: dict[str, int] | None = None) -> list[dict]:
    """`rpd`: requests a day, per model the probe has read it for (Groq's headers)."""
    tpm, tpd = settings.groq_tokens_per_minute, settings.groq_daily_token_limit
    rows = []
    for s in sizes:
        r = ROUTES[s["task"]]
        cap = _reply_budget(tier_model(r.tier), s["task"])["max_completion_tokens"]
        per_call = s["prompt_tokens"] + r.reply_tokens
        rows.append({
            **s,
            "model": tier_model(r.tier),
            "reply_planning": r.reply_tokens,
            "per_call": per_call,
            "per_minute": round(tpm / per_call, 1),
            "per_day": min(tpd // per_call, (rpd or {}).get(tier_model(r.tier), tpd)),
            "prompt_plus_cap": s["prompt_tokens"] + cap,
            "fits_minute_with_cap": s["prompt_tokens"] + cap <= tpm,
        })
    return rows


# ── 5. probe: does Groq count the reply cap against the minute? ──────────


def probe() -> dict:
    """One call on the small model: a three-word prompt with a reply cap above the
    minute's allowance. If Groq counts the cap in its per-minute check, it refuses the
    call outright (413/429, nothing generated); if not, it answers a word or two.
    Costs well under 200 tokens of the small model's day."""
    import httpx

    if not settings.llm_configured:
        return {"ran": False, "why": "no GROQ_API_KEY"}
    model = settings.groq_model_fast
    cap = settings.groq_tokens_per_minute + 1000
    body = {"model": model, "messages": [{"role": "user", "content": "Reply with: ok"}], "max_completion_tokens": cap, "temperature": 0, "reasoning_effort": "low", "include_reasoning": False}
    r = httpx.post(f"{settings.groq_base_url}/chat/completions", json=body, headers={"Authorization": f"Bearer {settings.groq_api_key}"}, timeout=30)
    try:
        message = (r.json().get("error") or {}).get("message", "")
    except ValueError:
        message = ""
    message = re.sub(r"org_\w+", "org_…", message)[:240]
    used = (r.json().get("usage") or {}) if r.status_code == 200 else {}
    headers = {k[len("x-ratelimit-"):]: v for k, v in r.headers.items() if k.startswith("x-ratelimit-")}
    return {
        "ran": True,
        "ran_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "model": model,
        "max_completion_tokens": cap,
        "status": r.status_code,
        "error": message or None,
        "tokens_used": used.get("total_tokens"),
        "headers": headers,
        "cap_counted": r.status_code in (413, 429) and "Requested" in message,
    }


# ── report ───────────────────────────────────────────────────────────────


def render(d: dict) -> str:
    tpm, tpd = d["limits"]["tpm"], d["limits"]["tpd"]
    L = ["# Routing and free-tier capacity", "", f"Rebuilt by `python -m eval.routing` on {d['ran_at'][:10]}. Tokens are characters ÷ 4; reply sizes are planning figures, not measurements.", ""]
    L += ["## Which model does what", "", "From `ROUTES` in `services/llm.py`. Every call has its own reply cap (thinking included); a failure moves to the other text model only where shown, and every such move is logged and counted (`usage.snapshot()['reroutes']`, on the admin page).", ""]
    L += ["| Task | Model | Reply cap | If it fails | When the day is nearly spent | Why this model |", "|---|---|---|---|---|---|"]
    L += [f"| `{r['task']}` | `{r['model']}` | {r['max_tokens']:,} | {r['on_failure']} | {r['day_nearly_spent']} | {r['why']} |" for r in d["table"]]
    L += ["", f"Retries: one request budget per call ({settings.groq_max_attempts} across both models, at most {settings.groq_max_retries} retries on one), never a retry after the first word, no same-model retry after a timeout or a refusal without a short Retry-After, and a model that was refused for longer than {settings.groq_max_retry_after_s:g} s is skipped by later calls until the wait is over.", ""]
    cs = d["call_sites"]
    L += ["### Call sites agree with the table", ""]
    L += [f"- {f}" for f in cs["findings"]] if cs["findings"] else [f"All {len(cs['sites'])} tagged call sites have a route, and each names its route's model."]
    runtime = [s for s in cs["sites"] if not s["tiers"]]
    if runtime:
        L += ["", "Decided at run time (no model named at the call site): " + ", ".join(f"`{s['task']}` in `{s['file']}` (`model={'/'.join(s['runtime']) or '?'}`)" for s in runtime) + "."]
    L += ["", "## What each call costs, and how many the free tier allows", "", f"Per model, shared by every student: {tpm:,} tokens a minute and {tpd:,} a day" + "".join(f"; `{m}` also allows {n:,} requests a day (Groq's `x-ratelimit-limit-requests` header, read by the probe), which caps its cheap tasks' daily count" for m, n in (d["limits"].get("rpd") or {}).items()) + ". A call costs its prompt plus its reply.", ""]
    L += ["| Task | Case | Prompt | + reply (planning) | Calls a minute | Calls a day | Prompt + reply cap | Fits one minute even if the cap counted |", "|---|---|---|---|---|---|---|---|"]
    L += [f"| `{r['task']}` | {r['case']} | {r['prompt_tokens']:,} | {r['reply_planning']:,} | {r['per_minute']} | {r['per_day']:,} | {r['prompt_plus_cap']:,} | {'yes' if r['fits_minute_with_cap'] else '**no**'} |" for r in d["capacity"]]
    p = d.get("probe") or {}
    L += [""]
    if p.get("ran"):
        verdict = "**counts** the reply cap against the minute's allowance: a call whose prompt plus cap is over the minute is refused before anything is generated" if p["cap_counted"] else "did **not** refuse it: the reply cap is not counted against the minute up front, only what is used"
        L += [f"**Does the reply cap count against the minute?** Probed {p['ran_at'][:10]}: one call to `{p['model']}` with a three-word prompt and a {p['max_completion_tokens']:,}-token cap (above the {tpm:,} minute). Groq answered {p['status']} and {verdict}." + (f" Its message: “{p['error']}”." if p.get("error") else "") + (f" The call used {p['tokens_used']} tokens." if p.get("tokens_used") else "") + (" So the last column is not a limit: a long reply cap costs nothing until it is used. What does bind a long chat is the prompt itself plus what the reply really uses." if not p["cap_counted"] else "")]
    else:
        L += ["**Does the reply cap count against the minute?** Not probed yet (`python -m eval.routing --probe`, one tiny call). Until then the last column is the worst case."]
    L += ["", "Brief and notes are not in the table: their prompts are built inside request handlers. A quiz is one `quiz.write` on the large model and one `quiz.verify` on the small one (plus `quiz.repair` when questions were dropped), so the two models' allowances are spent side by side.", ""]
    return "\n".join(L)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true", help="one tiny call on the small model (uses the Groq key)")
    args = parser.parse_args()
    prior = json.loads((RESULTS / "routing.json").read_text()) if (RESULTS / "routing.json").exists() else {}
    sizes = prompt_sizes()
    found = probe() if args.probe else prior.get("probe")
    rpd: dict[str, int] = {}
    if found and found.get("ran") and str((found.get("headers") or {}).get("limit-requests", "")).isdigit():
        rpd[found["model"]] = int(found["headers"]["limit-requests"])
    data = {
        "ran_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "limits": {"tpm": settings.groq_tokens_per_minute, "tpd": settings.groq_daily_token_limit, "rpd": rpd},
        "table": table(),
        "call_sites": call_sites(),
        "capacity": capacity(sizes, rpd),
        "probe": found,
    }
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "routing.json").write_text(json.dumps(data, indent=1, ensure_ascii=False))
    print(render(data))
    print(f"wrote {RESULTS / 'routing.json'}")


if __name__ == "__main__":
    main()
