/**
 * Skills: your collection and the library, editor panel on the right.
 *
 * This page is account-wide and has no on/off switches and no topic: you add
 * skills here (from the library, or written yourself) and turn them on for a
 * topic from the chat sidebar, where the topic is already obvious.
 * - "Library" cards clone the built-in template into the user's own skills so
 *   they can be edited without touching the shared row.
 * - The editor panel is a single form used for both create and update; when
 *   `selectedId` is null it saves a new skill.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createSkill,
  deleteSkill,
  listLibrarySkills,
  listSkills,
  updateSkill,
  type SkillInput,
} from '../../api/skills'
import type { MemoryScope, Skill, Tone } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input, Textarea } from '../../components/ui/Input'
import { Modal, ModalFooter } from '../../components/ui/Modal'
import { SectionLabel } from '../../components/ui/Bits'
import { Icon } from '../../components/ui/Icon'
import {
  LIBRARY_CATEGORY,
  LIBRARY_CATEGORY_ORDER,
  SKILL_ICON_CHOICES,
  SKILL_ICON_LIBRARY,
  resolveSkillIcon,
} from './skillIcon'
import { Skeleton } from '../../components/ui/Skeleton'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { toneDot, toneSoft, toneText } from '../../lib/tone'


const MEMORY_SCOPE_OPTIONS: { value: MemoryScope; label: string; hint: string }[] = [
  { value: 'session', label: 'This session', hint: 'Last ~8 messages.' },
  { value: 'topic', label: 'This topic', hint: 'A longer window of this topic’s history.' },
  { value: 'all', label: 'Everything', hint: 'The widest history window this topic has.' },
]

const emptyForm = (): SkillInput => ({
  name: '',
  icon: 'skill',
  tone: 'brand',
  description: '',
  instructions: '',
  // Sent for API-shape compatibility only. Nothing reads it — there is no
  // capability gate on the server — so it isn't offered as a control.
  capabilities: [],
  memory_scope: 'session',
  output_format: '',
})

/** The editor is a persistent side panel from `xl:` up and a modal below it. Which
 *  one renders has to be a real branch, not a `hidden` class: the panel is portal-
 *  free markup, the modal isn't, and rendering both would double the form. */
const XL_QUERY = '(min-width: 1280px)'

export function SkillsView() {
  const { show, showError } = useToast()
  const [own, setOwn] = useState<Skill[] | null>(null)
  const [library, setLibrary] = useState<Skill[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<SkillInput>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const isWide = useMediaQuery(XL_QUERY)
  const [editorOpen, setEditorOpen] = useState(false)
  const [customIconOpen, setCustomIconOpen] = useState(false)
  const outputFormatRef = useRef<HTMLTextAreaElement>(null)

  // Grows the box to fit what's typed instead of clipping it — a one-line
  // `Input` scrolled its own text sideways the moment a rule ran past the
  // field's width, which read as broken, not just cramped.
  useEffect(() => {
    const el = outputFormatRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [form.output_format, editorOpen])

  /** Every entry point into the form goes through here, so the modal opens. */
  const openEditor = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id === null) setForm(emptyForm())
    setCustomIconOpen(false)
    setEditorOpen(true)
  }, [])

  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setSelectedId(null)
    setForm(emptyForm())
    setCustomIconOpen(false)
  }, [])

  // Two reads, once: your skills and the library. Nothing here depends on a topic.
  const loadLists = useCallback(async () => {
    try {
      const [mine, lib] = await Promise.all([listSkills(), listLibrarySkills()])
      setOwn(mine)
      setLibrary(lib)
      setError(null)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }, [])

  useEffect(() => {
    void loadLists()
  }, [loadLists])

  const loading = own === null && !error

  /** The library grouped into its fixed shelves (see LIBRARY_CATEGORY's own
   *  comment on why this is a name lookup rather than a schema column). A
   *  custom skill with no shelf lands under a plain, header-less "More"
   *  bucket rather than silently vanishing from the grid. */
  const libraryShelves = useMemo(() => {
    if (!library) return []
    const byCategory = new Map<string, Skill[]>()
    const other: Skill[] = []
    for (const lib of library) {
      const category = LIBRARY_CATEGORY[lib.name]
      if (!category) {
        other.push(lib)
        continue
      }
      const bucket = byCategory.get(category) ?? []
      bucket.push(lib)
      byCategory.set(category, bucket)
    }
    const shelves: { category: string | null; skills: Skill[] }[] = LIBRARY_CATEGORY_ORDER
      .filter((c) => byCategory.has(c))
      .map((category) => ({ category, skills: byCategory.get(category)! }))
    if (other.length > 0) shelves.push({ category: null, skills: other })
    return shelves
  }, [library])

  const editingExisting = useMemo(
    () => own?.find((s) => s.id === selectedId) ?? null,
    [own, selectedId],
  )

  // Sync the form to the picked skill (or reset when nothing's picked).
  useEffect(() => {
    if (editingExisting) {
      setForm({
        name: editingExisting.name,
        icon: editingExisting.icon,
        tone: editingExisting.tone,
        description: editingExisting.description ?? '',
        instructions: editingExisting.instructions,
        capabilities: editingExisting.capabilities,
        memory_scope: editingExisting.memory_scope,
        output_format: editingExisting.output_format ?? '',
      })
    } else {
      setForm(emptyForm())
    }
  }, [editingExisting])

  const save = async () => {
    const name = form.name.trim()
    if (!name) return show('Give the skill a name.', 'error')
    const instructions = form.instructions.trim()
    if (!instructions) return show('Add instructions the AI can follow.', 'error')
    setBusy(true)
    try {
      const payload: SkillInput = {
        ...form,
        name,
        description: form.description?.trim() || null,
        instructions,
        output_format: form.output_format?.trim() || null,
      }
      if (editingExisting) {
        const updated = await updateSkill(editingExisting.id, payload)
        setOwn((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev))
        show('Skill saved.', 'success')
      } else {
        const created = await createSkill(payload)
        setOwn((prev) => (prev ? [created, ...prev] : [created]))
        setSelectedId(created.id)
        show('Skill created.', 'success')
      }
      setEditorOpen(false)
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteSkill(confirmDelete)
      setOwn((prev) => (prev ? prev.filter((s) => s.id !== confirmDelete) : prev))
      if (selectedId === confirmDelete) {
        setSelectedId(null)
        setEditorOpen(false)
      }
      setConfirmDelete(null)
      show('Skill deleted.', 'success')
    } catch (err) {
      showError(err)
    } finally {
      setDeleting(false)
    }
  }

  /** Own skills, by name — cloning "Exam Examiner" twice produced two
   *  identical "Exam Examiner" cards with no way to tell them apart short of
   *  opening each one, so a name already owned blocks a further clone. Name
   *  rather than a library-source id: nothing on `Skill` records which
   *  library row a clone came from, and a name collision is the actual
   *  thing that read as broken on screen. */
  const ownNames = useMemo(() => new Set((own ?? []).map((s) => s.name)), [own])

  const cloneLibrary = async (lib: Skill) => {
    if (ownNames.has(lib.name)) return
    try {
      const created = await createSkill({
        name: lib.name,
        icon: lib.icon,
        tone: lib.tone,
        description: lib.description ?? '',
        instructions: lib.instructions,
        capabilities: lib.capabilities,
        memory_scope: lib.memory_scope,
        output_format: lib.output_format,
      })
      setOwn((prev) => (prev ? [created, ...prev] : [created]))
      show(`Added "${lib.name}" — activate it below to apply to this space.`, 'success')
    } catch (err) {
      showError(err)
    }
  }

  /* One form, two containers. Rendered into the side panel at xl and into a
     modal below it — see XL_QUERY. */
  const editorBody = (
    <>
      <Input
        label="Name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Socratic Tutor"
      />

      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <span className="font-semibold text-muted">Icon &amp; colour</span>
        <div className="flex gap-1.5">
          {SKILL_ICON_CHOICES.map((choice) => {
            const active = form.icon === choice.icon && form.tone === choice.tone
            return (
              <button
                key={choice.icon}
                onClick={() => setForm({ ...form, icon: choice.icon, tone: choice.tone })}
                title={choice.label}
                aria-label={choice.label}
                className={cn(
                  'grid h-10 w-10 place-items-center rounded-[10px] border cursor-pointer transition-colors',
                  toneSoft[choice.tone],
                  toneText[choice.tone],
                  active ? 'border-brand' : 'border-transparent hover:border-line-dash',
                )}
              >
                <Icon name={choice.icon} size={16} />
              </button>
            )
          })}
          {/* None of the seven presets pair icon and tone the way you want?
              Pick both separately instead, rather than being stuck with one
              of seven fixed combinations. */}
          <button
            type="button"
            onClick={() => setCustomIconOpen((o) => !o)}
            title="Custom icon"
            aria-label="Custom icon"
            aria-expanded={customIconOpen}
            className={cn(
              'grid h-10 w-10 place-items-center rounded-[10px] border cursor-pointer transition-colors',
              customIconOpen
                ? 'border-brand bg-line-soft text-ink'
                : 'border-dashed border-line-dash text-faint hover:border-brand/50 hover:text-brand-deep',
            )}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>

        {customIconOpen && (
          <div className="mt-1 flex flex-col gap-2 rounded-[10px] border border-line bg-well/60 p-2.5">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(toneSoft) as Tone[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, tone: t })}
                  aria-label={`${t} tone`}
                  aria-pressed={form.tone === t}
                  className={cn(
                    'h-8 w-8 rounded-full border-2 cursor-pointer transition-transform',
                    toneDot[t],
                    form.tone === t ? 'border-ink scale-110' : 'border-transparent hover:scale-105',
                  )}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SKILL_ICON_LIBRARY.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => setForm({ ...form, icon: iconName })}
                  title={iconName}
                  aria-label={iconName}
                  className={cn(
                    'grid h-9 w-9 place-items-center rounded-md border cursor-pointer transition-colors',
                    toneSoft[form.tone ?? 'brand'],
                    toneText[form.tone ?? 'brand'],
                    form.icon === iconName
                      ? 'border-brand'
                      : 'border-transparent hover:border-line-dash',
                  )}
                >
                  <Icon name={iconName} size={14} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <Textarea
        label="Instructions"
        rows={6}
        value={form.instructions}
        onChange={(e) => setForm({ ...form, instructions: e.target.value })}
        placeholder="Ask one guiding question at a time. Never reveal the full answer until I've attempted it twice…"
        hint="Written in second person. Kept as a system prompt when this skill is active."
      />

      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <span className="font-semibold text-muted">Remembers</span>
        {/* The toggle above already controls WHERE this skill applies — every
            space it's switched on in, forever, until switched off. This
            row is a different axis entirely: how much of THIS topic's own
            chat history the skill can see while it's answering. Worth
            saying outright, because "Everything" sitting one row under a
            per-space activation toggle reads like "every space" if you
            don't stop to check — it isn't; it's still this topic only. */}
        <p className="text-[12.5px] leading-snug text-faint">
          How much of this topic's chat history it can see when answering —
          not where it's active. It stays scoped to this space either way.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {MEMORY_SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              title={opt.hint}
              onClick={() => setForm({ ...form, memory_scope: opt.value })}
              className={cn(
                'flex min-h-10 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13.5px] cursor-pointer',
                form.memory_scope === opt.value
                  ? 'bg-line-soft text-ink'
                  : 'border-[1.5px] border-line bg-canvas text-faint',
              )}
            >
              {form.memory_scope === opt.value && <Icon name="check" size={11} />}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <Textarea
        label="Output format"
        ref={outputFormatRef}
        rows={1}
        value={form.output_format ?? ''}
        onChange={(e) => setForm({ ...form, output_format: e.target.value })}
        placeholder="e.g. bullet points only, or one short paragraph"
        hint="Optional — a formatting rule added on top of the instructions above."
        className="resize-none overflow-hidden"
      />

    </>
  )

  /* Cancel left, primary right; the one destructive action (deleting an
     existing skill) is pinned to the far edge, away from the primary. */
  const editorFooter = (
    <ModalFooter
      start={
        editingExisting ? (
          <Button
            variant="ghost"
            onClick={() => setConfirmDelete(editingExisting.id)}
            className="text-coral-deep hover:bg-coral-soft hover:text-coral-deep"
          >
            Delete
          </Button>
        ) : undefined
      }
    >
      <Button variant="secondary" onClick={closeEditor} disabled={busy}>
        Cancel
      </Button>
      <Button onClick={save} disabled={busy} aria-busy={busy} className="min-w-36">
        {busy ? 'Saving…' : editingExisting ? 'Save changes' : 'Create skill'}
      </Button>
    </ModalFooter>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader
        title="Skills"
        tabs={false}
        actions={
          <Button onClick={() => openEditor(null)}>
            <Icon name="plus" size={15} /> New skill
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-6">
          <p className="text-[14px] leading-relaxed text-muted">
            Skills change how the AI talks — tutor personas with their own rules.
            Add some from the library or write your own. You turn them on for a
            topic from the sidebar in that topic&rsquo;s chat.
          </p>

          <SectionLabel>YOUR SKILLS</SectionLabel>

          {loading && (
            <div className="grid gap-3 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          )}

          {error && !loading && (
            <div className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
              {error}
            </div>
          )}

          {own !== null && !error && (
            <>
              {own.length === 0 ? (
                <EmptyState
                  icon="skill"
                  title="No skills yet"
                  description="Write your own, or add a template from the library below."
                  action={<Button onClick={() => openEditor(null)}>Write a skill</Button>}
                />
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {own.map((skill) => {
                    return (
                    <Card
                      key={skill.id}
                      className="group flex flex-col gap-2 p-3.5 transition-transform duration-200 hover:-translate-y-0.5"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'grid h-8 w-8 shrink-0 place-items-center rounded-[10px]',
                            toneSoft[skill.tone],
                            toneText[skill.tone],
                          )}
                        >
                          <Icon name={resolveSkillIcon(skill.icon)} size={16} />
                        </span>
                        <button
                          onClick={() => openEditor(skill.id)}
                          className={cn(
                            'min-h-10 min-w-0 flex-1 truncate text-left text-[15px] font-bold cursor-pointer',
                            selectedId === skill.id && 'text-brand',
                          )}
                        >
                          {skill.name}
                        </button>
                      </div>
                      {skill.description && (
                        <p className="text-[13px] text-muted line-clamp-2">
                          {skill.description}
                        </p>
                      )}
                      {/* CSS Grid stretches every card in a row to match the
                          tallest one — a short description next to a longer
                          neighbour's left dead air below this row instead of
                          between it and the description above. mt-auto turns
                          that into a footer that actually sits at the
                          card's bottom edge, however tall the card gets. */}
                      <div className="mt-auto flex items-center gap-3 text-[12.5px] text-faint">
                        <span>
                          Remembers {MEMORY_SCOPE_OPTIONS.find((o) => o.value === skill.memory_scope)?.label.toLowerCase() ?? 'this session'}
                        </span>
                        <button
                          onClick={() => setConfirmDelete(skill.id)}
                          className="-my-2 ml-auto min-h-10 rounded-md px-2 text-muted transition-[opacity,color] cursor-pointer hover:text-coral-deep pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
                        >
                          Remove
                        </button>
                      </div>
                    </Card>
                    )
                  })}
                </div>
              )}
            </>
          )}

          <SectionLabel className="mt-1">FROM THE LIBRARY</SectionLabel>
          {library === null ? (
            <div className="flex gap-2.5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 flex-1" />
              ))}
            </div>
          ) : library.length === 0 ? (
            <p className="text-[12.5px] text-muted">The library is empty right now.</p>
          ) : (
            // Ten cards in one undifferentiated row read as a wall, not a
            // menu — grouped by what each skill is actually for, "which one
            // do I want" becomes a two-step scan (shelf, then card) instead
            // of reading all ten descriptions. Shelves only exist for the
            // fixed library set (see LIBRARY_CATEGORY); nothing here reads
            // or needs a schema field.
            <div className="flex flex-col gap-3">
              {libraryShelves.map(({ category, skills }) => (
                <div key={category ?? '__other'} className="flex flex-col gap-1.5">
                  {category && <span className="setcode">{category}</span>}
                  <div className="flex flex-wrap gap-2.5 text-[12.5px]">
                    {skills.map((lib) => {
                      const owned = ownNames.has(lib.name)
                      return (
                      <Card key={lib.id} className="min-w-56 flex-1 p-3 transition-transform duration-200 hover:-translate-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'grid h-7 w-7 shrink-0 place-items-center rounded-md',
                              toneSoft[lib.tone],
                              toneText[lib.tone],
                            )}
                          >
                            <Icon name={resolveSkillIcon(lib.icon)} size={14} />
                          </span>
                          <b className="text-[14px]">{lib.name}</b>
                        </div>
                        {lib.description && (
                          <div className="mt-1 text-[13px] leading-snug text-muted">{lib.description}</div>
                        )}
                        {owned ? (
                          // Already cloned — a second "Add" produced a second,
                          // identical card with no way to tell the two apart
                          // short of opening each one. Disabled rather than
                          // hidden: still confirms the skill IS in your list,
                          // just not addable again.
                          <span className="mt-2 flex items-center gap-1 font-semibold text-faint">
                            <Icon name="check" size={12} /> Added
                          </span>
                        ) : (
                          <button
                            onClick={() => cloneLibrary(lib)}
                            className="mt-2 -mb-1.5 min-h-10 rounded-md pr-3 text-[13.5px] font-semibold text-brand cursor-pointer hover:text-brand-300"
                          >
                            Add →
                          </button>
                        )}
                      </Card>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* At xl the editor is a panel that lives beside the list; below xl
            it's a modal instead. Either way it only exists once you've
            actually asked for it — "+ New skill" in the header (or the empty state's button),
            or opening an existing one to edit. A form sitting open with
            nothing to fill in yet read as unfinished, not helpful. */}
        {editorOpen && (isWide ? (
          <aside className="flex w-[360px] shrink-0 flex-col border-l-[1.5px] border-line bg-surface">
            <h2 className="shrink-0 border-b border-line px-5 py-3.5 font-display text-[17px] font-semibold">
              {editingExisting ? 'Edit skill' : 'New skill'}
            </h2>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">{editorBody}</div>
            <div className="shrink-0 border-t border-line px-5 py-3.5">{editorFooter}</div>
          </aside>
        ) : (
          <Modal
            open={editorOpen}
            onClose={closeEditor}
            title={editingExisting ? 'Edit skill' : 'New skill'}
            width="lg"
            footer={editorFooter}
          >
            <div className="flex flex-col gap-3">{editorBody}</div>
          </Modal>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this skill?"
        description="It'll also stop being applied in any space where it's active."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={del}
        destructive
        loading={deleting}
      />
    </div>
  )
}
