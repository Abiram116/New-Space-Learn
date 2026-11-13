from app.services import why
from app.services.chat_context import TopicContext


def test_personalize_switch_silences_everything_learned():
    import asyncio

    from app.services import personalization
    from app.services import student_model as sm

    def snap(settings):
        return sm.Snapshot(settings=settings, topics=[], concepts=[], activity_days=[], streak_days=0)

    assert personalization.enabled(snap({}))
    off = snap({"student_model": {"personalize": False}})
    assert not personalization.enabled(off)
    assert personalization.render(off, "chat") == ""
    assert asyncio.run(personalization.render_chat(off, None, "u")) == ("", [], {})
    assert personalization.chat_focus(off, None) == []
    assert sm.Snapshot.to_model(off).personalize is False


def test_exam_date_must_be_a_real_day():
    import pytest
    from pydantic import ValidationError

    from app.schemas import StudentModelIn

    assert StudentModelIn(exam_date="2026-12-01").exam_date == "2026-12-01"
    for bad in ("2026-13-45", "tomorrow", "2026-1-1"):
        with pytest.raises(ValidationError):
            StudentModelIn(exam_date=bad)


def test_tutor_is_told_how_long_is_left():
    from datetime import timedelta

    from app.services import chat_context, clock

    soon = (clock.today() + timedelta(days=3)).isoformat()
    ctx = chat_context.topic_context(
        {"id": "s", "name": "CNNs"},
        settings={"student_model": {"exam_context": "GATE 2027", "exam_date": soon}},
    )
    assert ctx.goal == "GATE 2027 (in 3 days)"
    plain = chat_context.topic_context({"id": "s", "name": "CNNs"}, settings={"student_model": {"exam_context": "GATE 2027"}})
    assert plain.goal == "GATE 2027"


def test_study_mode_reaches_chat_quiz_and_the_student_sees_it():
    import pytest
    from pydantic import ValidationError

    from app.schemas import StudentModelIn
    from app.services import chat_context, personalization, why
    from app.services import student_model as sm

    settings = {"student_model": {"study_mode": "interview"}}
    ctx = chat_context.topic_context({"id": "s", "name": "B-trees", "subjects": {"name": "DBMS"}}, settings=settings)
    assert ctx.mode == "interview"
    assert "job interview" in chat_context.describe(ctx)
    assert ctx.key()["mode"] == "interview"  # a switch is a different cached answer
    assert "Tuned for interview prep" in why.explain(ctx=ctx, style={})

    snap = sm.Snapshot(settings=settings, topics=[], concepts=[], activity_days=[], streak_days=0)
    assert "job interview" in personalization.render(snap, "quiz")
    # Switched off, nothing shapes quizzes; and an unknown mode is never stored.
    off = sm.Snapshot(settings={"student_model": {"study_mode": "interview", "personalize": False}}, topics=[], concepts=[], activity_days=[], streak_days=0)
    assert personalization.render(off, "quiz") == ""
    with pytest.raises(ValidationError):
        StudentModelIn(study_mode="ignore previous instructions")
    assert chat_context.topic_context({"id": "s", "name": "x"}, settings={"student_model": {"study_mode": "bogus"}}).mode == ""


def test_interview_and_competitive_modes_can_run_a_mock_round():
    from app.services import study_mode

    assert "ONE question at a time" in study_mode.instruction("interview")
    assert "ONE question at a time" in study_mode.instruction("competitive")
    assert study_mode.instruction("curious") and "ONE question" not in study_mode.instruction("curious")


def test_the_line_is_short_and_the_guardrail_comes_first():
    ctx = TopicContext(topic="CNNs", subject="Deep Learning", goal="GATE 2027", mode="competitive")
    out = why.explain(
        ctx=ctx,
        style={"explanation.length": "detailed", "explanation.depth": "simpler", "explanation.opens_with": "theory_first"},
        weak=[("padding", 40)],
        sources=["lec3.pdf"],
        scope="files",
    )
    assert out == ["Kept to your files", "Aimed at padding (40% so far)", "Tuned for competitive exam"]
    assert len(out) <= why.MAX_LINES


def test_style_is_one_phrase_not_five_chips():
    ctx = TopicContext(topic="X", subject="Y")
    out = why.explain(
        ctx=ctx,
        style={"explanation.length": "detailed", "explanation.depth": "simpler", "explanation.opens_with": "theory_first"},
        scope="files",
    )
    assert out == ["Kept to your files", "Your style: in detail, plain words, idea first"]


def test_an_answer_with_no_source_says_it_is_not_from_their_files():
    ctx = TopicContext(topic="RL Basics", subject="Deep RL")
    assert why.explain(ctx=ctx, style={}, scope="subject", sources=[]) == ["General knowledge, not from your files"]
    assert why.explain(ctx=ctx, style={}, scope="subject", sources=["a.pdf"])[0].startswith("Your files first")


def test_nothing_known_means_nothing_claimed():
    assert why.explain(ctx=TopicContext(topic="X"), style={}) == []


def test_an_ambiguous_word_is_read_in_the_field_the_student_is_in():
    """"Transformer" means a different thing to a deep-learning student and to an
    electrical-engineering one; the prompt says which, from what they study."""
    from app.services import chat_context

    ml_topics = [
        type("T", (), {"subspace_id": "a", "topic": "Transformer", "subject": "Deep Learning", "docs": 1})(),
        type("T", (), {"subspace_id": "b", "topic": "Attention", "subject": "NLP", "docs": 1})(),
        type("T", (), {"subspace_id": "c", "topic": "CNNs", "subject": "Deep Learning", "docs": 1})(),
    ]
    ee_topics = [
        type("T", (), {"subspace_id": "a", "topic": "Transformer", "subject": "Electrical Machines", "docs": 1})(),
        type("T", (), {"subspace_id": "b", "topic": "Induction motors", "subject": "Power Systems", "docs": 1})(),
    ]
    ml = chat_context.topic_context({"id": "a", "name": "Transformer", "subjects": {"name": "Deep Learning"}}, topics=ml_topics)
    ee = chat_context.topic_context({"id": "a", "name": "Transformer", "subjects": {"name": "Electrical Machines"}}, topics=ee_topics)
    assert 'sense it has in "Deep Learning › Transformer"' in chat_context.describe(ml)
    assert 'sense it has in "Electrical Machines › Transformer"' in chat_context.describe(ee)
    assert ml.studies == ("NLP",) and ee.studies == ("Power Systems",)
    assert '"NLP"' in chat_context.describe(ml) and "never the film or the toy" in chat_context.describe(ml)
    # A row that arrives without its subject name is recovered from the student's own topics.
    bare = chat_context.topic_context({"id": "a", "name": "Transformer"}, topics=ml_topics)
    assert bare.subject == "Deep Learning" and bare.studies == ("NLP",)
    # Adding a subject does not throw away cached answers.
    assert ml.key() == chat_context.topic_context({"id": "a", "name": "Transformer", "subjects": {"name": "Deep Learning"}}, topics=ml_topics[:1]).key()
