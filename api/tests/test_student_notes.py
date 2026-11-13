"""The student-notes corpus: reproducible, readable, and its questions answerable."""

from io import BytesIO

from pypdf import PdfReader

from eval import add_student_questions as aq
from eval.corpus import CORPUS, TOPICS, questions, squash, supports
from eval.student_notes import NOTES, make_pdf


def test_the_pdfs_on_disk_are_exactly_what_the_generator_makes():
    for name, text in NOTES.items():
        assert (CORPUS / name).read_bytes() == make_pdf(text), f"{name} is stale: run python -m eval.student_notes"


def test_the_notes_read_back_with_headings_and_wrapped_lines():
    reader = PdfReader(BytesIO(make_pdf(NOTES["os_cpu_scheduling_notes.pdf"])))
    text = "\n".join(p.extract_text() for p in reader.pages)
    assert len(reader.pages) >= 2
    assert "convoy effect" in text and "FCFS" in text
    # Shorthand survives as written: this is the point of the corpus.
    assert "w/" in "\n".join(make_pdf(t).decode("latin-1") for t in [NOTES["dbms_transactions_notes.pdf"]])


def test_every_notes_question_can_be_answered_from_the_notes():
    qs = [q for q in questions() if q.topic == "notes"]
    assert len(qs) >= 30
    text = aq.notes_text()
    for q in qs:
        for group in q.evidence:
            assert any(squash(quote) in text for quote in group), q.id
        if q.category == "followup":
            assert q.history, q.id
    assert set(TOPICS["notes"]) == set(NOTES)


def test_lookalike_topics_exist_so_retrieval_cannot_win_on_topic_words_alone():
    """Deadlock appears in both the OS and the DBMS notes, starvation in two places:
    a question about one must not be answered from the other."""
    text = {n: squash(PdfReader(CORPUS / n).pages[0].extract_text() + "".join(p.extract_text() for p in PdfReader(CORPUS / n).pages[1:])) for n in NOTES}
    assert squash("deadlock") in text["os_cpu_scheduling_notes.pdf"]
    assert squash("deadlock") in text["dbms_transactions_notes.pdf"]
    wait_die = next(q for q in questions() if q.id == "nc02")
    assert not supports(PdfReader(CORPUS / "os_cpu_scheduling_notes.pdf").pages[0].extract_text(), wait_die.evidence[0])
