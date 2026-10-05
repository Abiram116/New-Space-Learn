/**
 * Skills: what they are in one sentence, ready-made ones to switch on, and
 * your own below — with a short form to write one.
 *
 * A skill changes how the tutor talks in a topic. It is switched on per topic,
 * so the page works for one topic at a time: the one you came from (the chat
 * sidebar's "Find more skills" passes `?topic=`), or else the one you used
 * last, changeable from a picker at the top. Every card then has the same
 * switch: "Use in <topic>".
 *
 * - A ready-made (library) skill is copied into your own skills the first time
 *   you switch it on, so you can edit it without touching the shared one.
 * - With no topic at all yet, ready-made skills can still be added to your
 *   list; the switches appear once there is a topic to use them in.
 * - The form is one form for both new and edit. Name, what it should do, and an
 *   optional example are all most people need; the rest sits behind
 *   "More options".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
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
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Input, Textarea } from '../../components/ui/Input'
import { Modal, ModalFooter } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
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
import { useSpaces } from '../spaces/SpacesProvider'

const MEMORY_SCOPE_OPTIONS: { value: MemoryScope; label: string; hint: string }[] = [
  { value: 'session', label: 'Recent chat', hint: 'The last few messages.' },
  { value: 'topic', label: 'More of this topic', hint: 'A longer stretch of this topic’s chat.' },
  { value: 'all', label: 'All of this topic', hint: 'As much of this topic’s chat as it can.' },
]

/**
 * The optional example is kept inside the instructions — the server has one
 * text field for what a skill does — under this line, and split back out when
 * the skill is opened again.
 */
export const EXAMPLE_MARKER = '\n\nExample of a good answer:\n'

export function splitExample(instructions: string): { what: string; example: string } {
  const at = instructions.indexOf(EXAMPLE_MARKER)
  if (at < 0) return { what: instructions, example: '' }
  return { what: instructions.slice(0, at), example: instructions.slice(at + EXAMPLE_MARKER.length) }
}

export function joinExample(what: string, example: string): string {
  const w = what.trim()
  const e = example.trim()
  return e ? `${w}${EXAMPLE_MARKER}${e}` : w
}

/** Ideas to start from, so a blank box is never the first thing you see. */
const STARTERS: { name: string; icon: string; tone: Tone; what: string }[] = [
  {
    name: 'Explain like I’m 5',
    icon: 'chat',
    tone: 'azure',
    what: 'Explain everything as simply as you can. Use short sentences, everyday examples and no jargon. If you must use a hard word, explain it right away.',
  },
  {
    name: 'Exam mode',
    icon: 'target',
    tone: 'mint',
    what: 'Act like my exam is tomorrow. Keep answers short and to the point, give me the key facts to remember, and end with one quick question to check I got it.',
  },
  {
    name: 'Quiz me first',
    icon: 'quiz',
    tone: 'sun',
    what: 'Before you explain anything, ask me what I already know with one short question. Then fill in only the gaps.',
  },
]

type Form = {
  name: string
  icon: string
  tone: Tone
  description: string
  what: string
  example: string
  memory_scope: MemoryScope
  output_format: string
}

const emptyForm = (): Form => ({
  name: '',
  icon: 'skill',
  tone: 'brand',
  description: '',
  what: '',
  example: '',
  memory_scope: 'session',
  output_format: '',
})

const formFrom = (s: Skill): Form => {
  const { what, example } = splitExample(s.instructions)
  return {
    name: s.name,
    icon: s.icon,
    tone: s.tone,
    description: s.description ?? '',
    what,
    example,
    memory_scope: s.memory_scope,
    output_format: s.output_format ?? '',
  }
}

/** A skill's one-line effect: its summary, or else the start of what it does. */
function effectOf(s: Skill): string {
  if (s.description?.trim()) return s.description.trim()
  const what = splitExample(s.instructions).what.trim()
  const first = what.split(/(?<=[.!?])\s/)[0] ?? what
  return first.length > 110 ? `${first.slice(0, 108)}…` : first
}

/** The editor is a side panel from `xl:` up and a modal below it. Which one
 *  renders has to be a real branch, not a `hidden` class, or the form doubles. */
const XL_QUERY = '(min-width: 1280px)'

export function SkillsView() {
  // Back is one step of browser history: wherever you came from — a chat,
  // Settings, anywhere. Opened directly (bookmark, new tab) there is no
  // "before" in this app, which the router marks with the "default" key, so it
  // goes Home instead.
  const navigate = useNavigate()
  const { key: locationKey } = useLocation()
  const goBack = useCallback(
    () => (locationKey === 'default' ? navigate('/home') : navigate(-1)),
    [locationKey, navigate],
  )
  const { show, showError } = useToast()
  const [own, setOwn] = useState<Skill[] | null>(null)
  const [library, setLibrary] = useState<Skill[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const isWide = useMediaQuery(XL_QUERY)
  const [editorOpen, setEditorOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [customIconOpen, setCustomIconOpen] = useState(false)
  const outputFormatRef = useRef<HTMLTextAreaElement>(null)

  /* ── Which topic the switches are for ── */
  const { spaces } = useSpaces()
  const [params, setParams] = useSearchParams()
  const topics = useMemo(
    () => spaces.flatMap((sp) => sp.subspaces.map((sub) => ({ ...sub, spaceName: sp.name }))),
    [spaces],
  )
  const asked = params.get('topic')
  const topic = useMemo(() => {
    const named = topics.find((t) => t.id === asked)
    if (named) return named
    // Otherwise the topic you were in last — the likeliest one you mean.
    return [...topics].sort((a, b) => (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''))[0] ?? null
  }, [topics, asked])
  const topicId = topic?.id ?? null

  const [activeIds, setActiveIds] = useState<ReadonlySet<string> | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    setActiveIds(null)
    if (!topicId) return
    let live = true
    listActiveSkills(topicId)
      .then((list) => live && setActiveIds(new Set(list.map((s) => s.id))))
      .catch(() => live && setActiveIds(new Set()))
    return () => {
      live = false
    }
  }, [topicId])

  // Grows the box to fit what's typed instead of clipping it.
  useEffect(() => {
    const el = outputFormatRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [form.output_format, editorOpen, moreOpen])

  /** Every entry point into the form goes through here, so the modal opens. */
  const openEditor = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id === null) setForm(emptyForm())
    setMoreOpen(false)
    setCustomIconOpen(false)
    setEditorOpen(true)
  }, [])

  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setSelectedId(null)
    setForm(emptyForm())
    setMoreOpen(false)
    setCustomIconOpen(false)
  }, [])

  // Two reads, once: your skills and the ready-made ones.
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

  /** The ready-made skills grouped by what they're for (see LIBRARY_CATEGORY),
   *  in a fixed order. One with no group goes last, untagged, rather than
   *  vanishing. */
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
    setForm(editingExisting ? formFrom(editingExisting) : emptyForm())
  }, [editingExisting])

  /** Your skills, by name: a ready-made one you already have is that one. */
  const ownByName = useMemo(() => new Map((own ?? []).map((s) => [s.name, s])), [own])

  const setBusyId = (id: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  /** Switches one of your skills on or off in the topic. Optimistic. */
  const setUse = async (skill: Skill, on: boolean) => {
    if (!topicId || pending.has(skill.id)) return
    setBusyId(skill.id, true)
    const flip = (want: boolean) =>
      setActiveIds((prev) => {
        const next = new Set(prev ?? [])
        if (want) next.add(skill.id)
        else next.delete(skill.id)
        return next
      })
    flip(on)
    try {
      if (on) await activateSkill(topicId, skill.id)
      else await deactivateSkill(topicId, skill.id)
    } catch (err) {
      flip(!on)
      showError(err)
    } finally {
      setBusyId(skill.id, false)
    }
  }

  /** A copy of a ready-made skill in your own list (made once, then reused). */
  const copyOf = async (lib: Skill): Promise<Skill> => {
    const have = ownByName.get(lib.name)
    if (have) return have
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
    return created
  }

  const addLibrary = async (lib: Skill) => {
    if (ownByName.has(lib.name) || pending.has(lib.id)) return
    setBusyId(lib.id, true)
    try {
      await copyOf(lib)
      show(`Added “${lib.name}” to your skills.`, 'success')
    } catch (err) {
      showError(err)
    } finally {
      setBusyId(lib.id, false)
    }
  }

  const switchLibrary = async (lib: Skill, on: boolean) => {
    const have = ownByName.get(lib.name)
    if (have) return setUse(have, on)
    if (!on || pending.has(lib.id)) return
    setBusyId(lib.id, true)
    try {
      const copy = await copyOf(lib)
      await setUse(copy, true)
    } catch (err) {
      showError(err)
    } finally {
      setBusyId(lib.id, false)
    }
  }

  const save = async () => {
    const name = form.name.trim()
    if (!name) return show('Give your skill a name.', 'error')
    if (!form.what.trim()) return show('Say what it should do. One sentence is enough.', 'error')
    setBusy(true)
    try {
      const payload: SkillInput = {
        name,
        icon: form.icon,
        tone: form.tone,
        description: form.description.trim() || null,
        instructions: joinExample(form.what, form.example),
        // Sent for API-shape compatibility only. Nothing reads it.
        capabilities: editingExisting?.capabilities ?? [],
        memory_scope: form.memory_scope,
        output_format: form.output_format.trim() || null,
      }
      if (editingExisting) {
        const updated = await updateSkill(editingExisting.id, payload)
        setOwn((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev))
        show('Saved.', 'success')
      } else {
        const created = await createSkill(payload)
        setOwn((prev) => (prev ? [created, ...prev] : [created]))
        setSelectedId(created.id)
        show(topic ? `Made “${created.name}”. Switch it on for ${topic.name} below.` : `Made “${created.name}”.`, 'success')
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

  /* ── The form ── */
  const isNew = !editingExisting
  const editorBody = (
    <>
      {isNew && !form.what && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-muted">Start from an idea, or write your own</span>
          <div className="flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => setForm({ ...form, name: form.name || s.name, icon: s.icon, tone: s.tone, what: s.what })}
                className={cn(
                  'flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-bold t-control duration-200 hover:brightness-125',
                  toneSoft[s.tone],
                  toneText[s.tone],
                )}
              >
                <Icon name={resolveSkillIcon(s.icon)} size={13} /> {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <Input
        id="skill-name"
        label="Name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="e.g. Explain like I’m 5"
      />

      <Textarea
        id="skill-what"
        label="What should it do?"
        rows={5}
        value={form.what}
        onChange={(e) => setForm({ ...form, what: e.target.value })}
        placeholder="e.g. Explain things simply, with everyday examples. Ask me one question at the end to check I got it."
        hint="Write it like you’d tell a friend who’s helping you study."
      />

      <Textarea
        id="skill-example"
        label="Example of a good answer (optional)"
        rows={3}
        value={form.example}
        onChange={(e) => setForm({ ...form, example: e.target.value })}
        placeholder="e.g. A cell is like a tiny factory. The nucleus is the boss’s office…"
        hint="Show it the kind of answer you like. It’ll copy the style, not the words."
      />

      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        aria-expanded={moreOpen}
        className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-[10px] border border-line px-3 text-left text-[13px] font-bold text-ink-2 transition-colors hover:border-line-dash hover:text-ink"
      >
        More options
        <span className="text-[12px] font-normal text-faint">Icon, summary, memory, format</span>
        <Icon name="chevronDown" size={14} className={cn('ml-auto text-faint transition-transform', moreOpen && 'rotate-180')} />
      </button>

      {moreOpen && (
        <div className="flex flex-col gap-4 rounded-[12px] border border-line-soft bg-well/40 p-3">
          <div className="flex flex-col gap-1.5 text-[12.5px]">
            <span className="font-semibold text-muted">Icon &amp; colour</span>
            <div className="flex flex-wrap gap-1.5">
              {SKILL_ICON_CHOICES.map((choice) => {
                const active = form.icon === choice.icon && form.tone === choice.tone
                return (
                  <button
                    key={choice.icon}
                    type="button"
                    onClick={() => setForm({ ...form, icon: choice.icon, tone: choice.tone })}
                    title={choice.label}
                    aria-label={choice.label}
                    aria-pressed={active}
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
                        toneSoft[form.tone],
                        toneText[form.tone],
                        form.icon === iconName ? 'border-brand' : 'border-transparent hover:border-line-dash',
                      )}
                    >
                      <Icon name={iconName} size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Input
            id="skill-summary"
        label="One-line summary"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="e.g. Short, simple answers with everyday examples"
            hint="Shown on the card so you remember what it does."
          />

          <div className="flex flex-col gap-1.5 text-[12.5px]">
            <span className="font-semibold text-muted">How much of the chat it remembers</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How much of the chat it remembers">
              {MEMORY_SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={form.memory_scope === opt.value}
                  title={opt.hint}
                  onClick={() => setForm({ ...form, memory_scope: opt.value })}
                  className={cn(
                    'flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px]',
                    form.memory_scope === opt.value
                      ? 'bg-line-soft text-ink'
                      : 'border-[1.5px] border-line bg-canvas text-faint hover:text-ink-2',
                  )}
                >
                  {form.memory_scope === opt.value && <Icon name="check" size={11} />}
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[12px] leading-snug text-faint">Only ever this topic’s chat, never other topics.</p>
          </div>

          <Textarea
            id="skill-format"
        label="Answer format"
            ref={outputFormatRef}
            rows={1}
            value={form.output_format}
            onChange={(e) => setForm({ ...form, output_format: e.target.value })}
            placeholder="e.g. Bullet points only, or one short paragraph"
            hint="A rule for how answers look, on top of what it does."
            className="resize-none overflow-hidden"
          />
        </div>
      )}
    </>
  )

  /* Cancel left, primary right; delete pinned to the far edge, away from it. */
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

  const switchFor = (on: boolean, busyNow: boolean, onChange: (on: boolean) => void, name: string) =>
    topic ? (
      <UseSwitch on={on} busy={busyNow || activeIds === null} topicName={topic.name} skillName={name} onChange={onChange} />
    ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader
        title="Skills"
        breadcrumb={false}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={goBack}>
              <Icon name="arrowLeft" size={14} /> Back
            </Button>
            <Button onClick={() => openEditor(null)}>
              <Icon name="plus" size={15} /> New skill
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 sm:px-6">
            {/* What this page is, in one sentence, and which topic the switches are for. */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <p className="max-w-[52ch] text-[16px] font-semibold leading-snug text-ink-2">
                Skills change how the tutor talks to you — like “Explain like I’m 5” or “Exam mode”.
                <span className="mt-1 block text-[13.5px] font-normal text-muted">
                  Switch one on and every answer in that topic changes. Switch it off any time.
                </span>
              </p>
              {topic && (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[13px] font-semibold text-muted">Using skills in</span>
                  <Select
                    ariaLabel="Topic to use skills in"
                    value={topic.id}
                    onChange={(id) => setParams((p) => {
                      p.set('topic', id)
                      return p
                    }, { replace: true })}
                    options={topics.map((t) => ({ value: t.id, label: `${t.name} · ${t.spaceName}` }))}
                    className="min-w-56"
                  />
                </div>
              )}
            </div>

            {error && !loading && (
              <div className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">{error}</div>
            )}

            {/* ── Ready-made ── */}
            <section aria-labelledby="skills-ready" className="flex flex-col gap-3">
              <h2 id="skills-ready" className="font-display text-[19px] font-bold text-ink">
                Ready-made
              </h2>
              {library === null && !error ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-28 rounded-[14px]" />
                  ))}
                </div>
              ) : library !== null && library.length === 0 ? (
                <p className="text-[13px] text-muted">No ready-made skills right now. Write your own below.</p>
              ) : (
                // One grid, ordered by what each is for, with that shown as a
                // small tag — shelves of one or two cards left most of the row empty.
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {libraryShelves.flatMap(({ category, skills }) =>
                    skills.map((lib) => {
                      const have = ownByName.get(lib.name)
                      const on = Boolean(have && activeIds?.has(have.id))
                      const busyNow = pending.has(lib.id) || Boolean(have && pending.has(have.id))
                      return (
                        <SkillCard
                          key={lib.id}
                          skill={lib}
                          on={on}
                          tag={category}
                          control={
                            topic ? (
                              switchFor(on, busyNow, (want) => void switchLibrary(lib, want), lib.name)
                            ) : have ? (
                              <span className="flex items-center gap-1 text-[12.5px] font-semibold text-faint">
                                <Icon name="check" size={12} /> Added
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void addLibrary(lib)}
                                disabled={busyNow}
                                className="min-h-9 cursor-pointer rounded-lg px-3 text-[13px] font-bold text-brand-deep transition-colors hover:bg-brand-soft disabled:cursor-progress disabled:opacity-60"
                              >
                                Add to my skills
                              </button>
                            )
                          }
                        />
                      )
                    }),
                  )}
                </div>
              )}
            </section>

            {/* ── My skills ── */}
            <section aria-labelledby="skills-mine" className="flex flex-col gap-3">
              <h2 id="skills-mine" className="font-display text-[19px] font-bold text-ink">
                My skills
              </h2>
              {loading ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-28 rounded-[14px]" />
                  ))}
                </div>
              ) : own !== null && own.length === 0 ? (
                <p className="rounded-[14px] border border-dashed border-line-dash px-4 py-5 text-[13.5px] text-muted">
                  Nothing here yet. Switch on a ready-made one above, or press New skill to write your own — it takes a minute.
                </p>
              ) : own !== null ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {own.map((skill) => {
                    const on = Boolean(activeIds?.has(skill.id))
                    return (
                      <SkillCard
                        key={skill.id}
                        skill={skill}
                        on={on}
                        selected={selectedId === skill.id && editorOpen}
                        onEdit={() => openEditor(skill.id)}
                        onRemove={() => setConfirmDelete(skill.id)}
                        control={switchFor(on, pending.has(skill.id), (want) => void setUse(skill, want), skill.name)}
                      />
                    )
                  })}
                </div>
              ) : null}
            </section>
          </div>
        </div>

        {/* At xl the form is a panel beside the list; below xl it's a modal.
            Either way it only exists once you've asked for it. */}
        {editorOpen && (isWide ? (
          <aside className="flex w-[380px] shrink-0 flex-col border-l-[1.5px] border-line bg-surface">
            <h2 className="shrink-0 border-b border-line px-5 py-3.5 font-display text-[17px] font-semibold">
              {editingExisting ? 'Edit skill' : 'New skill'}
            </h2>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">{editorBody}</div>
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
            <div className="flex flex-col gap-4">{editorBody}</div>
          </Modal>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this skill?"
        description="It also stops being used in every topic where it’s on."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={del}
        destructive
        loading={deleting}
      />
    </div>
  )
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function SkillCard({
  skill,
  on,
  control,
  tag,
  selected = false,
  onEdit,
  onRemove,
}: {
  skill: Skill
  on: boolean
  control: React.ReactNode
  /** What it's for (Exam, Learning…), as a small tag. */
  tag?: string | null
  selected?: boolean
  onEdit?: () => void
  onRemove?: () => void
}) {
  return (
    <article
      className={cn(
        'group flex flex-col gap-2.5 rounded-[14px] border p-3.5 transition-colors',
        on ? 'border-brand/60 bg-brand-tint' : 'cardstock',
        selected && 'ring-2 ring-brand/50',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', toneSoft[skill.tone], toneText[skill.tone])}>
          <Icon name={resolveSkillIcon(skill.icon)} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="block max-w-full cursor-pointer truncate text-left text-[15px] font-bold text-ink hover:text-brand-deep"
            >
              {skill.name}
            </button>
          ) : (
            <h3 className="truncate text-[15px] font-bold text-ink">{skill.name}</h3>
          )}
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{effectOf(skill)}</p>
        </div>
        {tag && <span className="setcode shrink-0 pt-0.5">{tag}</span>}
      </div>
      <div className="mt-auto flex min-h-9 items-center gap-1">
        {control}
        {onEdit && (
          <span className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              onClick={onEdit}
              className="min-h-9 cursor-pointer rounded-lg px-2.5 text-[12.5px] font-semibold text-ink-3 transition-colors hover:bg-line-soft hover:text-ink"
            >
              Edit
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${skill.name}`}
                className="min-h-9 cursor-pointer rounded-lg px-2.5 text-[12.5px] font-semibold text-muted transition-[opacity,color] hover:text-coral-deep pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
              >
                Remove
              </button>
            )}
          </span>
        )}
      </div>
    </article>
  )
}

/** "Use in <topic>": one switch, the same on every card. */
function UseSwitch({
  on,
  busy,
  topicName,
  skillName,
  onChange,
}: {
  on: boolean
  busy: boolean
  topicName: string
  skillName: string
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Use ${skillName} in ${topicName}`}
      onClick={() => onChange(!on)}
      disabled={busy}
      className="group/switch -ml-1 flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1 text-left disabled:cursor-progress disabled:opacity-60"
    >
      <span
        aria-hidden
        className={cn(
          'relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors',
          on ? 'bg-brand' : 'bg-line-dash group-hover/switch:bg-ink-3/50',
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] h-[16px] w-[16px] rounded-full bg-canvas transition-[left]',
            on ? 'left-[16px]' : 'left-[2px]',
          )}
        />
      </span>
      <span className={cn('truncate text-[12.5px] font-bold', on ? 'text-brand-deep' : 'text-ink-3')}>
        {on ? `On in ${topicName}` : 'Use in this topic'}
      </span>
    </button>
  )
}
