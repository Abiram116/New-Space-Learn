/**
 * Skills: user's personas on the left, editor panel on the right.
 *
 * - Toggling a skill's switch activates/deactivates it inside the current
 *   subspace (so the chat prompt reflects it immediately).
 * - "Library" cards clone the built-in template into the user's own skills so
 *   they can be edited without touching the shared row.
 * - The editor panel is a single form used for both create and update; when
 *   `selectedId` is null it saves a new skill.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  activateSkill,
  createSkill,
  deactivateSkill,
  deleteSkill,
  listActiveSkills,
  listLibrarySkills,
  listSkills,
  updateSkill,
  type SkillInput,
} from '../../api/skills'
import type { MemoryScope, Skill, Tone } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Card, DashedCard } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input, Textarea } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { SectionLabel, Toggle } from '../../components/ui/Bits'
import { Icon } from '../../components/ui/Icon'
import {
  LIBRARY_CATEGORY,
  LIBRARY_CATEGORY_ORDER,
  SKILL_ICON_CHOICES,
  SKILL_ICON_LIBRARY,
  resolveSkillIcon,
} from './skillIcon'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { toneDot, toneHex, toneSoft, toneText } from '../../lib/tone'
import { SubspaceMissing } from '../spaces/SubspaceMissing'


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

/**
 * The editor is a persistent side panel at xl and a modal below it. Which one
 * renders has to be a real branch, not a `hidden` class: the panel is portal-
 * free markup, the modal isn't, and rendering both would double the form.
 */
function useIsWide(query = '(min-width: 1280px)') {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return wide
}

export function SkillsView() {
  const { space, subspace } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return <Inner subspaceId={subspace.id} />
}

function Inner({ subspaceId }: { subspaceId: string }) {
  const { show, showError } = useToast()
  const [own, setOwn] = useState<Skill[] | null>(null)
  const [library, setLibrary] = useState<Skill[] | null>(null)
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<SkillInput>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const isWide = useIsWide()
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

  const refresh = useCallback(async () => {
    try {
      const [mine, lib, active] = await Promise.all([
        listSkills(),
        listLibrarySkills(),
        listActiveSkills(subspaceId),
      ])
      setOwn(mine)
      setLibrary(lib)
      setActiveIds(new Set(active.map((s) => s.id)))
      setError(null)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }, [subspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

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

  const toggleActive = async (skill: Skill, next: boolean) => {
    // Optimistic — flip local state first, roll back on error.
    setActiveIds((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(skill.id)
      else copy.delete(skill.id)
      return copy
    })
    try {
      if (next) await activateSkill(subspaceId, skill.id)
      else await deactivateSkill(subspaceId, skill.id)
    } catch (err) {
      setActiveIds((prev) => {
        const copy = new Set(prev)
        if (next) copy.delete(skill.id)
        else copy.add(skill.id)
        return copy
      })
      showError(err)
    }
  }

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
      setActiveIds((prev) => {
        const copy = new Set(prev)
        copy.delete(confirmDelete)
        return copy
      })
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
     modal below it — see useIsWide. */
  const editorBody = (
    <>
      <Input
        label="Name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Socratic Tutor"
      />

      <div className="flex flex-col gap-1.5 text-xs">
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
                  'grid h-9 w-9 place-items-center rounded-[10px] border cursor-pointer transition-colors',
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
              'grid h-9 w-9 place-items-center rounded-[10px] border cursor-pointer transition-colors',
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
                    'h-6 w-6 rounded-full border-2 cursor-pointer transition-transform',
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
                    'grid h-8 w-8 place-items-center rounded-md border cursor-pointer transition-colors',
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

      <div className="flex flex-col gap-1.5 text-xs">
        <span className="font-semibold text-muted">Remembers</span>
        {/* The toggle above already controls WHERE this skill applies — every
            space it's switched on in, forever, until switched off. This
            row is a different axis entirely: how much of THIS topic's own
            chat history the skill can see while it's answering. Worth
            saying outright, because "Everything" sitting one row under a
            per-space activation toggle reads like "every space" if you
            don't stop to check — it isn't; it's still this topic only. */}
        <p className="text-[11px] leading-snug text-faint">
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
                'flex items-center gap-1 rounded-full px-2.5 py-1.5 cursor-pointer',
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

      <div className="mt-auto flex gap-2 pt-3">
        <Button onClick={save} disabled={busy} className="flex-1">
          {busy ? 'Saving…' : editingExisting ? 'Save changes' : 'Create skill'}
        </Button>
        {(editingExisting || !isWide) && (
          <Button variant="secondary" onClick={closeEditor}>
            Cancel
          </Button>
        )}
      </div>
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader
        title="Skills"
        actions={<Button onClick={() => openEditor(null)}>+ New skill</Button>}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-6">
          <p className="text-[13px] text-muted">
            Skills are reusable instructions the AI applies inside this space —
            think of them as tutor personas with their own rules and tools.
          </p>

          <SectionLabel>ACTIVE IN THIS SPACE</SectionLabel>

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
                    const active = activeIds.has(skill.id)
                    return (
                    <Card
                      key={skill.id}
                      className={cn(
                        'group flex flex-col gap-2 border-l-[3px] p-3.5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5',
                        !active && 'border-l-transparent',
                      )}
                      // This section shows every skill you own, active or
                      // not — the switch was the only thing saying which is
                      // which. A left edge in the skill's own colour, present
                      // only while it's actually affecting this space, reads
                      // at a glance without requiring the switch's state to
                      // be parsed first.
                      style={active ? { borderLeftColor: toneHex[skill.tone] } : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'grid h-8 w-8 shrink-0 place-items-center rounded-[10px]',
                            active ? toneSoft[skill.tone] : 'bg-line-soft',
                            active ? toneText[skill.tone] : 'text-faint',
                          )}
                        >
                          <Icon name={resolveSkillIcon(skill.icon)} size={16} />
                        </span>
                        <button
                          onClick={() => openEditor(skill.id)}
                          className={cn(
                            'flex-1 text-left text-[15px] font-bold cursor-pointer',
                            selectedId === skill.id && 'text-brand',
                          )}
                        >
                          {skill.name}
                        </button>
                        <Toggle
                          checked={active}
                          onChange={(next) => toggleActive(skill, next)}
                          label={`Enable ${skill.name}`}
                        />
                      </div>
                      {skill.description && (
                        <p className="text-xs text-muted line-clamp-2">
                          {skill.description}
                        </p>
                      )}
                      {/* CSS Grid stretches every card in a row to match the
                          tallest one — a short description next to a longer
                          neighbour's left dead air below this row instead of
                          between it and the description above. mt-auto turns
                          that into a footer that actually sits at the
                          card's bottom edge, however tall the card gets. */}
                      <div className="mt-auto flex items-center gap-3 text-[11px] text-faint">
                        <span>
                          Remembers {MEMORY_SCOPE_OPTIONS.find((o) => o.value === skill.memory_scope)?.label.toLowerCase() ?? 'this session'}
                        </span>
                        <button
                          onClick={() => setConfirmDelete(skill.id)}
                          className="ml-auto opacity-0 group-hover:opacity-100 hover:text-coral-deep transition-opacity cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </Card>
                    )
                  })}
                  <DashedCard
                    onClick={() => openEditor(null)}
                    // self-start: without it, Grid's default row-stretch
                    // matches this to the tallest real skill card sharing
                    // its row, leaving the centered "+" floating in a box
                    // far bigger than the deliberately compact 100px this
                    // was designed at.
                    className="flex min-h-[100px] flex-col items-center justify-center gap-1.5 self-start p-3.5 text-[13px] text-muted transition-colors cursor-pointer hover:border-brand/50 hover:text-brand-deep"
                  >
                    <Icon name="plus" size={18} />
                    Write your own skill
                  </DashedCard>
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
            <p className="text-xs text-muted">The library is empty right now.</p>
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
                  <div className="flex flex-wrap gap-2.5 text-xs">
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
                          <b>{lib.name}</b>
                        </div>
                        {lib.description && (
                          <div className="mt-1 text-muted">{lib.description}</div>
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
                            className="mt-2 font-semibold text-brand cursor-pointer"
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
            actually asked for it — "Write your own skill", "+ New skill",
            or opening an existing one to edit. A form sitting open with
            nothing to fill in yet read as unfinished, not helpful. */}
        {editorOpen && (isWide ? (
          <aside className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l-[1.5px] border-line bg-surface p-5">
            <h2 className="font-display text-[15px] font-semibold">
              {editingExisting ? 'Edit skill' : 'New skill'}
            </h2>
            {editorBody}
          </aside>
        ) : (
          <Modal
            open={editorOpen}
            onClose={closeEditor}
            title={editingExisting ? 'Edit skill' : 'New skill'}
            width="lg"
          >
            <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
              {editorBody}
            </div>
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
