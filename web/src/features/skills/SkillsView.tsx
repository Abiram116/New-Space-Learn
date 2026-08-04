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

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import type { Skill, Tone } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Card, DashedCard } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input, Textarea } from '../../components/ui/Input'
import { SectionLabel, Toggle } from '../../components/ui/Bits'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { toneSoft } from '../../lib/tone'
import { SubspaceMissing } from '../spaces/SubspaceMissing'

const ICON_CHOICES: { icon: string; tone: Tone }[] = [
  { icon: '🧠', tone: 'brand' },
  { icon: '🎯', tone: 'mint' },
  { icon: '✍️', tone: 'sun' },
  { icon: '📘', tone: 'sky' },
  { icon: '🔬', tone: 'coral' },
]

const CAPABILITY_OPTIONS = [
  { value: 'docs', label: 'Indexed docs' },
  { value: 'quiz', label: 'Quiz agent' },
  { value: 'flashcards', label: 'Flashcards' },
]

const emptyForm = (): SkillInput => ({
  name: '',
  icon: '🧠',
  tone: 'brand',
  description: '',
  instructions: '',
  capabilities: ['docs', 'quiz'],
})

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
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!confirmDelete) return
    try {
      await deleteSkill(confirmDelete)
      setOwn((prev) => (prev ? prev.filter((s) => s.id !== confirmDelete) : prev))
      setActiveIds((prev) => {
        const copy = new Set(prev)
        copy.delete(confirmDelete)
        return copy
      })
      if (selectedId === confirmDelete) setSelectedId(null)
      setConfirmDelete(null)
      show('Skill deleted.', 'success')
    } catch (err) {
      showError(err)
    }
  }

  const cloneLibrary = async (lib: Skill) => {
    try {
      const created = await createSkill({
        name: lib.name,
        icon: lib.icon,
        tone: lib.tone,
        description: lib.description ?? '',
        instructions: lib.instructions,
        capabilities: lib.capabilities,
      })
      setOwn((prev) => (prev ? [created, ...prev] : [created]))
      setSelectedId(created.id)
      show(`Added "${lib.name}" — activate it below to apply to this space.`, 'success')
    } catch (err) {
      showError(err)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader
        title="Skills"
        actions={
          <Button
            onClick={() => {
              setSelectedId(null)
              setForm(emptyForm())
            }}
          >
            + New skill
          </Button>
        }
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
                  icon="🎯"
                  title="No skills yet"
                  description="Write one on the right, or add a template from the library below."
                />
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {own.map((skill) => (
                    <Card key={skill.id} className="group flex flex-col gap-2 p-3.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'flex h-7.5 w-7.5 items-center justify-center rounded-[10px]',
                            toneSoft[skill.tone],
                          )}
                        >
                          {skill.icon}
                        </span>
                        <button
                          onClick={() => setSelectedId(skill.id)}
                          className={cn(
                            'flex-1 text-left text-sm font-bold cursor-pointer',
                            selectedId === skill.id && 'text-brand',
                          )}
                        >
                          {skill.name}
                        </button>
                        <Toggle
                          checked={activeIds.has(skill.id)}
                          onChange={(next) => toggleActive(skill, next)}
                          label={`Enable ${skill.name}`}
                        />
                      </div>
                      {skill.description && (
                        <p className="text-xs text-muted line-clamp-2">
                          {skill.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 text-[11px] text-faint">
                        <span>
                          {skill.capabilities.length} capabilit
                          {skill.capabilities.length === 1 ? 'y' : 'ies'}
                        </span>
                        <button
                          onClick={() => setConfirmDelete(skill.id)}
                          className="ml-auto opacity-0 group-hover:opacity-100 hover:text-coral-deep transition-opacity cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </Card>
                  ))}
                  <DashedCard
                    onClick={() => {
                      setSelectedId(null)
                      setForm(emptyForm())
                    }}
                    className="flex flex-col items-center justify-center gap-1 p-3.5 text-[13px] cursor-pointer hover:border-brand"
                  >
                    <span className="text-xl text-brand">+</span>
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
            <div className="flex flex-wrap gap-2.5 text-xs">
              {library.map((lib) => (
                <Card key={lib.id} className="min-w-56 flex-1 p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-md',
                        toneSoft[lib.tone],
                      )}
                    >
                      {lib.icon}
                    </span>
                    <b>{lib.name}</b>
                  </div>
                  {lib.description && (
                    <div className="mt-1 text-muted">{lib.description}</div>
                  )}
                  <button
                    onClick={() => cloneLibrary(lib)}
                    className="mt-2 font-semibold text-brand cursor-pointer"
                  >
                    Add →
                  </button>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Editor panel */}
        <aside className="hidden w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l-[1.5px] border-line bg-surface p-5 xl:flex">
          <h2 className="font-display text-[15px] font-semibold">
            {editingExisting ? 'Edit skill' : 'New skill'}
          </h2>

          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Socratic Tutor"
          />

          <div className="flex flex-col gap-1.5 text-xs">
            <span className="font-semibold text-muted">Icon &amp; colour</span>
            <div className="flex gap-1.5">
              {ICON_CHOICES.map((choice) => {
                const active = form.icon === choice.icon && form.tone === choice.tone
                return (
                  <button
                    key={choice.icon}
                    onClick={() =>
                      setForm({ ...form, icon: choice.icon, tone: choice.tone })
                    }
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-[10px] border-[1.5px] cursor-pointer',
                      toneSoft[choice.tone],
                      active ? 'border-brand' : 'border-transparent',
                    )}
                  >
                    {choice.icon}
                  </button>
                )
              })}
            </div>
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
            <span className="font-semibold text-muted">Can use</span>
            <div className="flex flex-wrap gap-1.5">
              {CAPABILITY_OPTIONS.map((cap) => {
                const on = form.capabilities?.includes(cap.value) ?? false
                return (
                  <button
                    key={cap.value}
                    onClick={() =>
                      setForm({
                        ...form,
                        capabilities: on
                          ? form.capabilities?.filter((c) => c !== cap.value) ?? []
                          : [...(form.capabilities ?? []), cap.value],
                      })
                    }
                    className={cn(
                      'rounded-full px-2.5 py-1.5 cursor-pointer',
                      on
                        ? 'bg-line-soft text-ink'
                        : 'border-[1.5px] border-line bg-canvas text-faint',
                    )}
                  >
                    {on ? '✓ ' : ''}
                    {cap.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-auto flex gap-2 pt-3">
            <Button onClick={save} disabled={busy} className="flex-1">
              {busy ? 'Saving…' : editingExisting ? 'Save changes' : 'Create skill'}
            </Button>
            {editingExisting && (
              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedId(null)
                  setForm(emptyForm())
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this skill?"
        description="It'll also stop being applied in any space where it's active."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={del}
        destructive
      />
    </div>
  )
}
