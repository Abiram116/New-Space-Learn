/**
 * "How the AI answers" — the Skills switched on for this topic, in the dock.
 *
 * This is the ONLY place a skill is turned on or off: the topic is already
 * obvious here, so nothing needs a picker or a page of its own. The account-wide
 * `/skills` page is just the collection — add skills from the library or write
 * your own — and the picker below offers exactly those, so one small request
 * (your skills) is all it ever costs, and only when it is opened.
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

/** How many not-yet-on skills the picker lists before pointing at the full page. */
const PICKER_LIMIT = 5

export function DockSkills({ subspaceId }: { subspaceId: string }) {
  const { showError } = useToast()
  // Deliberately NOT cached under a shared key. The API client clears every
  // `skills:` cache entry after any successful skill write, which would empty
  // this list the instant a toggle was confirmed. Plain component state is
  // unaffected, and only one of this and the phone strip is ever on screen.
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

  /** Optimistic: the list changes at once and is put back if the server refuses. */
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
      <DockSectionHead
        id="dock-skills-label"
        aside={
          !skills.loading && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="setcode cursor-pointer transition-colors hover:text-ink"
            >
              {open ? 'Close' : active.length > 0 ? 'Change' : 'Pick one'}
            </button>
          )
        }
      >
        Answer style
      </DockSectionHead>

      {skills.loading ? (
        <Skeleton className="h-14 rounded-[10px]" />
      ) : (
        <div className="flex flex-col gap-1.5">
          {active.length === 0 && (
            <p className="text-[12px] leading-snug text-muted">None yet. Answers are plain and direct.</p>
          )}
          {active.map((skill) => (
            <div
              key={skill.id}
              title={skill.description ?? undefined}
              className="cardstock flex min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 py-1.5"
            >
              <span
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-md',
                  toneSoft[skill.tone],
                  toneText[skill.tone],
                )}
              >
                <Icon name={resolveSkillIcon(skill.icon)} size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">{skill.name}</span>
              <button
                type="button"
                role="switch"
                aria-checked="true"
                onClick={() => void toggle(skill, false)}
                disabled={pending.has(skill.id)}
                aria-label={`Turn off ${skill.name}`}
                title="On. Click to turn off."
                className="group/switch flex shrink-0 cursor-pointer items-center rounded-full py-1 pl-1 pr-0.5 disabled:cursor-progress disabled:opacity-50"
              >
                <span className="relative h-[18px] w-[30px] rounded-full bg-ink-2 transition-colors group-hover/switch:bg-ink">
                  <span className="absolute right-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-canvas" />
                </span>
              </button>
            </div>
          ))}

          {active.length > 2 && (
            <p className="text-[11.5px] leading-snug text-muted">
              Several styles at once can pull in different directions. Turn some off if answers feel mixed.
            </p>
          )}
          {open && (
            <SkillPicker
              activeIds={activeIds}
              pending={pending}
              onTurnOn={(skill) => void toggle(skill, true)}
              skillsPage="/skills"
            />
          )}
        </div>
      )}
    </section>
  )
}

function SkillPicker({
  activeIds,
  pending,
  onTurnOn,
  skillsPage,
}: {
  activeIds: ReadonlySet<string>
  pending: ReadonlySet<string>
  onTurnOn: (skill: Skill) => void
  skillsPage: string
}) {
  // Plain component state, not a shared cache key: the API client clears every
  // `skills:` entry after a skill is turned on, which would empty this list (and
  // read as "you have no skills") the moment you tapped Turn on.
  const own = useAsync(() => listSkills(), [])

  const offered = useMemo(
    () => (own.data ?? []).filter((s) => !activeIds.has(s.id)),
    [own.data, activeIds],
  )

  if (own.loading) return <Skeleton className="h-24 rounded-[10px]" />
  if (own.error) return <p className="text-[11.5px] text-muted">{own.error}</p>
  if (offered.length === 0) {
    const none = (own.data ?? []).length === 0
    return (
      <p className="rounded-[10px] border border-line bg-raised px-2.5 py-3 text-center text-[11.5px] leading-snug text-muted">
        {none ? 'You haven’t added any skills yet. ' : 'All your skills are on. '}
        <Link to={skillsPage} className="font-bold text-brand-deep">
          {none ? 'Browse the library →' : 'Add more →'}
        </Link>
      </p>
    )
  }

  const shown = offered.slice(0, PICKER_LIMIT)
  return (
    <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-raised p-1.5">
      {shown.map((skill) => (
        <div key={skill.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
          <span
            className={cn(
              'grid h-6 w-6 shrink-0 place-items-center rounded-md',
              toneSoft[skill.tone],
              toneText[skill.tone],
            )}
          >
            <Icon name={resolveSkillIcon(skill.icon)} size={12} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-bold text-ink">{skill.name}</span>
            <span className="block truncate text-[10.5px] text-muted">{skill.description ?? ''}</span>
          </span>
          <button
            type="button"
            onClick={() => onTurnOn(skill)}
            disabled={pending.has(skill.id)}
            className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11.5px] font-bold text-brand-deep transition-colors hover:bg-brand-soft disabled:cursor-progress disabled:opacity-50"
          >
            Turn on
          </button>
        </div>
      ))}
      <Link
        to={skillsPage}
        className="px-1.5 pb-0.5 pt-1 text-[11.5px] font-bold text-muted transition-colors hover:text-ink"
      >
        {offered.length > shown.length ? `See all ${offered.length} of your skills →` : 'Find more skills →'}
      </Link>
    </div>
  )
}
