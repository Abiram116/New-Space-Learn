"""The notes editor stores markdown and renders with `html: false`, so any
HTML that reaches it is escaped and shown as literal visible text.

This is a real bug that shipped: a student's note contained a printed
`&lt;p&gt;to expand on the PPT structure...&lt;/p&gt;`. The first version of
`_demote_html` handled raw `<p>` tags but returned early whenever the text
had no literal `<` — so entity-escaped tags, which is what the model actually
emitted, passed straight through.
"""

from __future__ import annotations

import pytest

from app.routers.notes import _demote_html


def test_raw_tags_are_demoted():
    assert _demote_html("<p>Intro to MDPs.</p>") == "Intro to MDPs."


def test_entity_escaped_tags_are_demoted():
    """The exact failure a student reported seeing in their note."""
    out = _demote_html(
        "&lt;p&gt;to expand on the PPT structure, the introduction should "
        "cover the definition of MDPs.&lt;/p&gt;"
    )
    assert "&lt;" not in out
    assert "<p" not in out
    assert out.startswith("to expand on the PPT structure")


def test_entity_structure_becomes_real_markdown():
    out = _demote_html(
        "&lt;h2&gt;Key components&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;States&lt;/li&gt;"
        "&lt;li&gt;Actions&lt;/li&gt;&lt;/ul&gt;"
    )
    assert "## Key components" in out
    assert "- States" in out
    assert "- Actions" in out


def test_mixed_raw_and_entity_tags():
    out = _demote_html("&lt;p&gt;one&lt;/p&gt;<p>two</p>")
    assert "&lt;" not in out and "<p" not in out
    assert "one" in out and "two" in out


def test_clean_markdown_is_left_alone():
    md = "# Title\n\n- a\n- b\n\n**bold** and *em*"
    assert _demote_html(md) == md


def test_fenced_code_block_survives_untouched():
    """A student asking about HTML gets an answer whose point IS the tags."""
    md = 'Use this:\n\n```html\n<div class="x">hi</div>\n```\n\ndone'
    out = _demote_html(md)
    assert '<div class="x">hi</div>' in out


def test_inline_code_survives_untouched():
    out = _demote_html("The `<br>` tag breaks lines.")
    assert "`<br>`" in out


def test_entities_inside_code_stay_literal():
    """Inside a fence an entity is content the student asked to see."""
    out = _demote_html("```\n&lt;p&gt;literal\n```")
    assert "&lt;p&gt;" in out


@pytest.mark.parametrize(
    "text",
    ["", "   ", "plain text", "no tags here at all"],
)
def test_degenerate_inputs_do_not_raise(text: str):
    _demote_html(text)
