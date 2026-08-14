"""`/ai`, Summarise, Explain, Expand and friends, run on an AI-generated note.

Every one of these that had nothing selected fell back to a whole-note
instruction ("Summarise the note so far", "Expand the last point in this
note"). The endpoint's prompt was built from indexed material and recent chat
only — never the note's own body — so on any note whose words never entered
either of those (every AI note started via the "AI note" dialog, not chat),
the model was asked to summarise a note it had never been shown. `_note_context`
is what closes that gap; these tests pin its two branches.
"""

from app.routers.notes import _note_context


def test_returns_the_note_text_stripped() -> None:
    assert _note_context("  Q-learning converges under these conditions.  ") == (
        "Q-learning converges under these conditions."
    )


def test_empty_note_gets_an_explicit_placeholder_not_a_blank_string() -> None:
    """A blank string interpolated into the prompt reads as 'material:' with
    nothing after it — indistinguishable from a formatting slip. Saying the
    note is empty is what lets the model react to that fact correctly (write
    something, rather than 'summarise' nothing)."""
    assert _note_context("") == "(the note is empty so far)"
    assert _note_context("   ") == "(the note is empty so far)"
