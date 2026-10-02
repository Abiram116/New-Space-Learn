"""What the feedback says, worked out from the stored responses.

Pure functions over rows already read from the database: no queries, no model
calls. Everything is counted in one pass over the period's responses, so the
cost is the size of that period and nothing else.

A stored response's `answers` is a list of
`{question_id, prompt, kind, value}` — the prompt travels with the answer, so
a question edited or deleted since still reads right here.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import UTC, date, datetime, timedelta, tzinfo
from statistics import median
from typing import Any

from ..schemas import (
    FeedbackDay,
    FeedbackKeyword,
    FeedbackSummaryItem,
    FeedbackSummaryOut,
    FeedbackTextAnswer,
)

#: The most written answers returned per question, newest first.
TEXTS_MAX = 40
KEYWORDS_MAX = 10
#: The longest daily chart, whatever the period.
CHART_DAYS_MAX = 90

_WORD = re.compile(r"[a-z][a-z'\-]{2,}")
# Words that say nothing about the product. Short on purpose: a word has to
# appear in two different answers to be shown at all.
_STOP = frozenset(
    """the and for that this with have from are was were but not you your our can will would could should
    just very really more much some any all its it's i'm i've don't doesn't didn't also too than then
    them they there their what when which who how why about into out one get got like been being has had
    did does make made use used using app space learn spacelearn thing things something nothing good great
    nice need want wish think feel lot bit even still only because while where here over well maybe please
    add adding able etc yes""".split()
)


def parse_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _overall(answers: list[dict[str, Any]]) -> int | None:
    """The person's overall rating: their first 1–5 answer."""
    for a in answers:
        if a.get("kind") == "rating" and isinstance(a.get("value"), int):
            return a["value"]
    return None


def _averages(rows: list[dict[str, Any]]) -> dict[str, float]:
    sums: dict[str, list[int]] = {}
    for row in rows:
        for a in row.get("answers") or []:
            value = a.get("value")
            if a.get("kind") in ("rating", "scale") and isinstance(value, int) and not isinstance(value, bool):
                sums.setdefault(str(a.get("question_id")), []).append(value)
    return {qid: sum(v) / len(v) for qid, v in sums.items()}


def _keywords(texts: list[str]) -> list[FeedbackKeyword]:
    seen: Counter[str] = Counter()
    for text in texts:
        # Once per answer: one person repeating a word is not a theme.
        seen.update({w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 3})
    return [FeedbackKeyword(word=w, count=n) for w, n in seen.most_common(KEYWORDS_MAX) if n >= 2]


def _percent(part: int, whole: int) -> int:
    return round(100 * part / whole) if whole else 0


def summarise(
    rows: list[dict[str, Any]],
    *,
    previous: list[dict[str, Any]] | None = None,
    days: int = 0,
    zone: tzinfo | None = None,
    today: date | None = None,
) -> FeedbackSummaryOut:
    """`rows` are this period's responses, newest first; `previous` the period
    before it (None when there is no "before", i.e. all time)."""
    items: dict[str, FeedbackSummaryItem] = {}
    numbers: dict[str, list[int]] = {}
    per_day: Counter[date] = Counter()
    sources: Counter[str] = Counter()
    signed_in = want_reply = 0

    for row in rows:
        answers = row.get("answers") or []
        created = parse_time(row.get("created_at"))
        if created:
            per_day[(created.astimezone(zone) if zone else created).date()] += 1
        sources[str(row.get("source") or "unknown")] += 1
        if row.get("user_id") is not None:
            signed_in += 1
        elif row.get("contact_email"):
            want_reply += 1
        score = _overall(answers)

        for a in answers:
            qid = str(a.get("question_id"))
            kind = str(a.get("kind", ""))
            item = items.get(qid)
            if item is None:
                # The newest wording wins: rows arrive newest first.
                item = items[qid] = FeedbackSummaryItem(
                    question_id=qid, prompt=str(a.get("prompt", "")), kind=kind, responses=0
                )
            item.responses += 1
            value = a.get("value")
            if kind in ("rating", "scale") and isinstance(value, int) and not isinstance(value, bool):
                numbers.setdefault(qid, []).append(value)
            elif kind == "choice" and isinstance(value, str):
                item.counts[value] = item.counts.get(value, 0) + 1
            elif kind == "multi" and isinstance(value, list):
                for v in value:
                    item.counts[str(v)] = item.counts.get(str(v), 0) + 1
            elif kind in ("short", "long") and isinstance(value, str) and value.strip():
                item.texts.append(FeedbackTextAnswer(text=value.strip(), created_at=created, score=score))

    before = _averages(previous) if previous else {}
    for qid, values in numbers.items():
        item = items[qid]
        low, high = (1, 5) if item.kind == "rating" else (0, 10)
        tally = Counter(values)
        item.average = round(sum(values) / len(values), 2)
        item.median = float(median(values))
        item.distribution = {str(n): tally.get(n, 0) for n in range(low, high + 1)}
        if qid in before:
            item.previous_average = round(before[qid], 2)
        if item.kind == "rating":
            item.positive_share = _percent(sum(1 for v in values if v >= 4), len(values))
        else:
            item.promoters = sum(1 for v in values if v >= 9)
            item.detractors = sum(1 for v in values if v <= 6)
            item.passives = len(values) - item.promoters - item.detractors
            item.nps = _percent(item.promoters - item.detractors, len(values))

    for item in items.values():
        if item.texts:
            item.keywords = _keywords([t.text for t in item.texts])
            del item.texts[TEXTS_MAX:]
        if item.counts:
            item.counts = dict(sorted(item.counts.items(), key=lambda kv: -kv[1]))

    out = FeedbackSummaryOut(
        days=days,
        total=len(rows),
        previous_total=len(previous) if previous is not None else None,
        by_day=_chart(per_day, days, today),
        sources=dict(sources),
        signed_in=signed_in,
        visitors=len(rows) - signed_in,
        want_reply=want_reply,
        items=list(items.values()),
    )
    out.takeaways = takeaways(out)
    return out


def _chart(per_day: Counter[date], days: int, today: date | None) -> list[FeedbackDay]:
    """One entry per day, quiet days included, oldest first."""
    if not per_day and not days:
        return []
    end = today or max(per_day, default=date.today())
    span = days or ((end - min(per_day, default=end)).days + 1)
    span = max(1, min(span, CHART_DAYS_MAX))
    start = end - timedelta(days=span - 1)
    return [
        FeedbackDay(date=(start + timedelta(days=i)).isoformat(), count=per_day.get(start + timedelta(days=i), 0))
        for i in range(span)
    ]


def _moved(now: float, before: float | None) -> str:
    if before is None or abs(now - before) < 0.05:
        return ""
    return f", {'up' if now > before else 'down'} from {before:g}"


def takeaways(s: FeedbackSummaryOut) -> list[str]:
    """The summary as a few plain sentences, most important first."""
    if not s.total:
        return []
    out: list[str] = []
    period = f"in the last {s.days} days" if s.days else "so far"
    line = f"{s.total} {'response' if s.total == 1 else 'responses'} {period}"
    if s.previous_total is not None and s.previous_total != s.total:
        line += f" — {'up' if s.total > s.previous_total else 'down'} from {s.previous_total} in the {s.days} days before"
    out.append(line + ".")

    ratings = [i for i in s.items if i.kind == "rating" and i.average is not None]
    if ratings:
        first = ratings[0]
        out.append(
            f"“{first.prompt}” averages {first.average:g} out of 5{_moved(first.average or 0, first.previous_average)}; "
            f"{first.positive_share}% gave it 4 or 5."
        )
        if len(ratings) > 1:
            weakest = min(ratings, key=lambda i: i.average or 0)
            strongest = max(ratings, key=lambda i: i.average or 0)
            if weakest is not strongest and weakest.average != strongest.average:
                out.append(
                    f"Strongest: “{strongest.prompt}” ({strongest.average:g}). "
                    f"Weakest: “{weakest.prompt}” ({weakest.average:g})."
                )
    for item in s.items:
        if item.nps is not None:
            mood = "more promoters than detractors" if item.nps > 0 else "more detractors than promoters" if item.nps < 0 else "an even split"
            out.append(
                f"Recommend score {item.nps:+d} on “{item.prompt}”: {item.promoters} would recommend it, "
                f"{item.detractors} would not — {mood}."
            )
    for item in [i for i in s.items if i.counts][:3]:
        choice, n = next(iter(item.counts.items()))
        out.append(f"Most picked for “{item.prompt}”: {choice} ({_percent(n, item.responses)}% of answers).")
    low = sum(1 for i in s.items for t in i.texts if t.score is not None and t.score <= 2)
    if low:
        out.append(f"{low} written {'answer comes' if low == 1 else 'answers come'} from people who rated it 1 or 2 — read those first.")
    if s.want_reply:
        out.append(f"{s.want_reply} {'visitor' if s.want_reply == 1 else 'visitors'} left an email address and may be waiting for a reply.")
    return out
