/**
 * "How I answer" — the skill that is on for this topic, as one chip, and a
 * Change link that opens a short list of your skills with a switch each.
 *
 * Skills change how the tutor talks; they are not actions (see `agents.ts`).
 * The chip says which voice is on at a glance; everything else waits behind
 * Change. The Skills page is where skills are found and written — the link at
 * the foot of the list goes there with this topic picked, so a skill added
 * there can be switched on in the same visit.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { activateSkill, deactivateSkill, listActiveSkills, listSkills } from '../../api/skills'
import type { Skill } from '../../api/types'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { toneSoft, toneText } from '../../lib/tone'
import { useAsync } from '../../lib/useAsync'
import { resolveSkillIcon } from '../skills/skillIcon'
import { DockSectionHead } from './dockParts'

/** How many skills the list shows before pointing at the Skills page. */
const PICKER_LIMIT = 6

/** The Skills page, opened for this topic. */
export const skillsPageFor = (subspaceId: string) => `/skills?topic=${encodeURIComponent(subspaceId)}`

export function DockSkills({ subspaceId }: { subspaceId: string }) {
  const { showError } = useToast()
  // Deliberately NOT cached under a shared key. The API client clears every
  // `skills:` cache entry after any successful skill write, which would empty
  // this list the instant a toggle was confirmed. Plain component state is
  // unaffected, and only one of this and the tablet strip is ever on screen.
  const skills = useAsync(() => listActiveSkills(subspaceId), [subspaceId])
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())

  const activeList = skills.data
  const active = activeList ?? []
  const activeIds = useMemo(() => new Set((activeList ?? []).map((s) => s.id)), [activeList])

  const setBusy = (id: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  /** Optimistic: the chip changes at once and is put back if the server refuses. */
  const toggle = async (skill: Skill, on: boolean) => {
    if (pending.has(skill.id)) return
    setBusy(skill.id, true)
    skills.setData((prev) => {
      const list = prev ?? []
      return on ? [...list.filter((s) => s.id !== skill.id), skill] : list.filter((s) => s.id !== skill.id)
    })
    try {
      if (on) await activateSkill(subspaceId, skill.id)
      else await deactivateSkill(subspaceId, skill.id)
    } catch (err) {
      skills.setData((prev) => {
        const list = prev ?? []
        return on ? list.filter((s) => s.id !== skill.id) : [...list, skill]
      })
      showError(err)
    } finally {
      setBusy(skill.id, false)
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="dock-skills-label">
      <DockSectionHead id="dock-skills-label">How I answer</DockSectionHead>

      {skills.loading ? (
        <Skeleton className="h-11 rounded-[10px]" />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex min-h-11 items-center gap-2 rounded-[10px] border border-line bg-raised py-1.5 pl-1.5 pr-1">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {active.length === 0 ? (
                <span className="flex min-h-8 items-center gap-2 rounded-full bg-line-soft py-1 pl-1.5 pr-3 text-[12.5px] font-bold text-ink-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-well text-ink-3">
                    <Icon name="chat" size={12} />
                  </span>
                  Normal
                </span>
              ) : (
                active.map((skill) => (
                  <span
                    key={skill.id}
                    title={skill.description ?? undefined}
                    className={cn(
                      'flex min-h-8 min-w-0 max-w-full items-center gap-2 rounded-full py-1 pl-1.5 pr-3 text-[12.5px] font-bold',
                      toneSoft[skill.tone],
                      toneText[skill.tone],
                    )}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-black/20">
                      <Icon name={resolveSkillIcon(skill.icon)} size={12} />
                    </span>
                    <span className="truncate">{skill.name}</span>
                  </span>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="min-h-8 shrink-0 cursor-pointer rounded-md px-2.5 text-[12.5px] font-bold text-brand-deep transition-colors hover:bg-brand-soft"
            >
              {open ? 'Done' : 'Change'}
            </button>
          </div>

          {!open && active.length === 0 && (
            <p className="text-[11.5px] leading-snug text-muted">Plain, direct answers. Tap Change to try a style, like exam mode.</p>
          )}
          {active.length > 2 && (
            <p className="text-[11.5px] leading-snug text-muted">
              Lots of styles at once can clash. Turn some off if answers feel mixed.
            </p>
          )}
          {open && (
            <SkillPicker
              active={active}
              activeIds={activeIds}
              pending={pending}
              onToggle={(skill, on) => void toggle(skill, on)}
              skillsPage={skillsPageFor(subspaceId)}
            />
          )}
        </div>
      )}
    </section>
  )
}

function SkillPicker({
  active,
  activeIds,
  pending,
  onToggle,
  skillsPage,
}: {
  /** What is on now (it may include a skill the list hasn't caught up with). */
  active: Skill[]
  activeIds: ReadonlySet<string>
  pending: ReadonlySet<string>
  onToggle: (skill: Skill, on: boolean) => void
  skillsPage: string
}) {
  // Plain component state, not a shared cache key: the API client clears every
  // `skills:` entry after a skill is turned on, which would empty this list (and
  // read as "you have no skills") the moment a switch was flipped.
  const own = useAsync(() => listSkills(), [])

  // Every skill you have, each with its own switch, so turning one off is as
  // easy as turning one on. The order is the list's own and never shuffles
  // under the pointer; only a skill that is on but missing from it (it was
  // just added elsewhere) goes first.
  const offered = useMemo(() => {
    const list = own.data ?? []
    const known = new Set(list.map((s) => s.id))
    return [...active.filter((s) => !known.has(s.id)), ...list]
  }, [own.data, active])

  if (own.loading) return <Skeleton className="h-24 rounded-[10px]" />
  if (own.error) return <p className="text-[11.5px] text-muted">{own.error}</p>
  if (offered.length === 0) {
    return (
      <p className="rounded-[10px] border border-line bg-raised px-3 py-3 text-[12px] leading-snug text-muted">
        You don’t have any skills yet.{' '}
        <Link to={skillsPage} className="font-bold text-brand-deep hover:underline">
          Pick a ready-made one →
        </Link>
      </p>
    )
  }

  const shown = offered.slice(0, PICKER_LIMIT)
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] border border-line bg-raised p-1.5">
      {shown.map((skill) => {
        const on = activeIds.has(skill.id)
        return (
          <button
            key={skill.id}
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={skill.name}
            onClick={() => onToggle(skill, !on)}
            disabled={pending.has(skill.id)}
            className="group/switch flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-line-soft disabled:cursor-progress disabled:opacity-60"
          >
            <span
              className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md', toneSoft[skill.tone], toneText[skill.tone])}
            >
              <Icon name={resolveSkillIcon(skill.icon)} size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-bold text-ink">{skill.name}</span>
              {skill.description && <span className="block truncate text-[11px] text-muted">{skill.description}</span>}
            </span>
            <span
              aria-hidden
              className={cn(
                'relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors',
                on ? 'bg-brand' : 'bg-line-dash group-hover/switch:bg-ink-3/50',
              )}
            >
              <span
                className={cn(
                  'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-canvas transition-[left]',
                  on ? 'left-[14px]' : 'left-[2px]',
                )}
              />
            </span>
          </button>
        )
      })}
      <Link
        to={skillsPage}
        className="mt-0.5 flex min-h-9 items-center gap-1.5 rounded-lg px-1.5 text-[12px] font-bold text-muted transition-colors hover:bg-line-soft hover:text-ink"
      >
        <Icon name="plus" size={13} />
        {offered.length > shown.length ? `See all ${offered.length}, or find more` : 'Find more skills'}
      </Link>
    </div>
  )
}
