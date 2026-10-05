/**
 * "How I answer" — the skills that are on for this topic, one clear row each
 * (or "Normal"), and a Change button that opens your skills with a switch each.
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
import { DockHeadButton, DockSectionHead } from './dockParts'

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

  const changeButton = (
    <DockHeadButton onClick={() => setOpen((v) => !v)} aria-expanded={open} pressed={open}>
      {open ? 'Done' : 'Change'}
    </DockHeadButton>
  )

  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="dock-skills-label">
      <DockSectionHead id="dock-skills-label" aside={skills.loading ? undefined : changeButton}>
        How I answer
      </DockSectionHead>

      {skills.loading ? (
        <Skeleton className="h-16 rounded-[14px]" />
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="cardstock flex flex-col overflow-hidden rounded-[14px]" aria-label="On in this topic">
            {active.length === 0 ? (
              <li className="flex min-h-[3.75rem] items-center gap-3 px-3 py-2.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-line-soft text-ink-3">
                  <Icon name="chat" size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold leading-snug text-ink">Normal</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-muted">
                    Plain, direct answers. Tap Change to try a style, like exam mode.
                  </span>
                </span>
              </li>
            ) : (
              active.map((skill) => (
                <li
                  key={skill.id}
                  title={skill.description ?? undefined}
                  className="flex min-h-[3.75rem] items-center gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0"
                >
                  <span
                    className={cn(
                      'grid h-10 w-10 shrink-0 place-items-center rounded-[10px]',
                      toneSoft[skill.tone],
                      toneText[skill.tone],
                    )}
                  >
                    <Icon name={resolveSkillIcon(skill.icon)} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold leading-snug text-ink">{skill.name}</span>
                    {skill.description && (
                      <span className="mt-0.5 block truncate text-[13px] leading-snug text-muted">{skill.description}</span>
                    )}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-mint-soft px-2.5 py-1 text-[12px] font-bold text-mint-deep">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-mint" />
                    On
                  </span>
                </li>
              ))
            )}
          </ul>

          {active.length > 2 && (
            <p className="text-[13px] leading-snug text-muted">
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

  if (own.loading) return <Skeleton className="h-32 rounded-[14px]" />
  if (own.error) return <p className="text-[13px] text-muted">{own.error}</p>
  if (offered.length === 0) {
    return (
      <p className="rounded-[14px] border border-line bg-raised px-3.5 py-3.5 text-[13.5px] leading-snug text-muted">
        You don’t have any skills yet.{' '}
        <Link to={skillsPage} className="font-bold text-brand-deep hover:underline">
          Pick a ready-made one →
        </Link>
      </p>
    )
  }

  const shown = offered.slice(0, PICKER_LIMIT)
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] border border-line bg-raised p-1.5">
      <p className="px-2 pb-1 pt-1.5 text-[13px] font-semibold text-muted">Switch styles on or off for this topic</p>
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
            className={cn(
              'group/switch flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-line-soft disabled:cursor-progress disabled:opacity-60',
              on && 'bg-brand-tint',
            )}
          >
            <span
              className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', toneSoft[skill.tone], toneText[skill.tone])}
            >
              <Icon name={resolveSkillIcon(skill.icon)} size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-bold text-ink">{skill.name}</span>
              {skill.description && <span className="block truncate text-[12.5px] text-muted">{skill.description}</span>}
            </span>
            <span
              aria-hidden
              className={cn(
                'relative h-6 w-10 shrink-0 rounded-full transition-colors',
                on ? 'bg-brand' : 'bg-line-dash group-hover/switch:bg-ink-3/50',
              )}
            >
              <span
                className={cn(
                  'absolute top-[3px] left-[3px] h-[18px] w-[18px] rounded-full bg-canvas transition-transform',
                  on && 'translate-x-4',
                )}
              />
            </span>
          </button>
        )
      })}
      <Link
        to={skillsPage}
        className="mt-0.5 flex min-h-11 items-center gap-2 rounded-[10px] px-2 text-[13.5px] font-bold text-muted transition-colors hover:bg-line-soft hover:text-ink"
      >
        <Icon name="plus" size={16} />
        {offered.length > shown.length ? `See all ${offered.length}, or find more` : 'Find more skills'}
      </Link>
    </div>
  )
}
