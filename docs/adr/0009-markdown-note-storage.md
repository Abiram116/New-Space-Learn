# ADR-0009 — Store notes as markdown, not structured editor JSON

- **Status:** Accepted
- **Date:** 2026-08-05
- **Related:** `api/app/routers/notes.py`, `plan-frontend.md §10`, `plan-backend.md §9b`

## Context

Notes began as a plain textarea holding a markdown string (`notes.body_md`).
The rebuild added a real rich-text editor with a formatting toolbar and an
inline `/ai` command. A live screenshot confirmed the old implementation was
leaking raw markdown to the screen — `**bold**` rendering as literal
asterisks.

## Problem

Two coupled decisions: which editor, and what shape the data is stored in. An
editor with a native document model (Tiptap/ProseMirror) prefers to store its
own JSON; markdown is a lossier but far more portable interchange format.

## Decision

**Adopt Tiptap for the editor; keep `notes.body_md` as a markdown string.**
Markdown is converted at the editor boundary via `tiptap-markdown`, not stored
as ProseMirror JSON.

## Alternatives considered

1. **Hand-rolled `contentEditable` editor.** Rejected: the toolbar requirement
   (bold/italic/underline/strikethrough/lists at minimum) became explicit and
   non-negotiable, and hand-rolling a correct undo stack, keyboard shortcuts,
   and list handling is substantial, high-risk work. `plan-frontend.md §10`
   reasoned this through and landed on "whichever gets a correct, accessible
   toolbar with the least hand-rolled risk."
2. **Tiptap with `jsonb` ProseMirror storage.** Rejected: it would require
   changing `generate_note`'s and the inline-AI endpoint's output format, make
   the stored data opaque to anything but this editor, and complicate any
   future export or citation-extraction use. The gain (lossless fidelity for
   complex nodes) isn't needed by any current feature.
3. **Tiptap with markdown storage.** Chosen — smaller change, portable data,
   and every existing note stays valid without migration.

## Trade-offs

**Cost:** markdown is lossy for anything richer than it can express, and the
conversion boundary is a real source of bugs — which materialized immediately
(below).

**Benefit:** no migration, no changes to the two endpoints that write note
content, human-readable stored data, and trivial reuse of note text as LLM
context (a markdown string can be dropped straight into a prompt; ProseMirror
JSON cannot).

**The bug this decision introduced, and the mitigation:** Tiptap is configured
`html: false`, so any HTML tag reaching the editor renders as literal visible
text. Models emit stray `<p>` and `<br>` tags under some prompts, so notes
ended up containing printed HTML. Fixed with two layers:

1. The inline-AI prompt explicitly forbids HTML and enumerates the markdown
   equivalents to use instead.
2. `notes.py::_demote_html()` converts common block and inline tags to
   markdown anyway, then strips anything still tag-shaped.

The second layer exists because, per its own comment: "instructing the model
not to emit HTML is necessary but not sufficient — models regress under load
and on unusual prompts, and a note is the student's own document." That
reasoning is the transferable lesson: **a prompt instruction is not an
enforcement mechanism.** The same principle applies to citation markers
(`AI_ENGINE.md §10`), where the enforcement layer is still missing.

## Consequences

- Tiptap and its extensions are a real dependency weight — isolated into its
  own lazy route chunk, which is part of how first load got to 245KB gzipped.
- `plan-backend.md §9b`, which framed this as an open question, was corrected
  to record the resolution.
- If a future feature needs a node type markdown can't express (a rich
  embedded diagram, say), that's the trigger to revisit — not a reason to
  pre-emptively switch now.

## Future migration path

Moving to `jsonb` ProseMirror storage later is mechanical but touches three
places: the column type, `generate_note`'s output, and the `/ai`-inline
fragment format. Markdown could be retained as a generated export field. Only
worth doing if a genuinely non-representable node type is needed.
