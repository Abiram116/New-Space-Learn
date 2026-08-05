/**
 * The right dock: what this topic knows, and what you can do with it.
 *
 * The two AI concepts are deliberately given different shapes, because naming
 * them differently was not enough:
 *
 *   Skills — cards. A stack you equip; each is a personality that stays on and
 *            changes how every answer is written. Card-shaped, like the
 *            character cards they are.
 *   Agents — buttons with a bolt. One-shot actions that hand you an artifact
 *            and finish. Deliberately not card-shaped.
 */

import { Link } from 'react-router-dom'
import { listDocuments } from '../../api/documents'
import { listActiveSkills } from '../../api/skills'
import { useAsync } from '../../lib/useAsync'
import { cn } from '../../lib/cn'
import { toneSoft, toneText } from '../../lib/tone'
import { SectionLabel } from '../../components/ui/Bits'
import { DashedCard } from '../../components/ui/Card'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { SourceItem } from '../docs/SourceItem'
import { AGENT_ICON, AGENT_LABELS, AGENT_RESULT, AGENT_TONE, type AgentKey } from './agents'

const AGENTS: AgentKey[] = ['notes', 'flashcards', 'quiz']

export function ContextDock({
  subspaceId,
  base,
  onRunAgent,
}: {
  subspaceId: string
  base: string
  onRunAgent: (agent: AgentKey) => void
}) {
  const docs = useAsync(() => listDocuments(subspaceId), [subspaceId])
  const skills = useAsync(() => listActiveSkills(subspaceId), [subspaceId])

  const docList = docs.data ?? []
  const skillList = skills.data ?? []

  return (
    <aside className="hidden w-[268px] shrink-0 flex-col gap-5 overflow-y-auto overflow-x-hidden border-l border-line bg-surface p-3.5 lg:flex">
      {/* ── Actions ── */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Do something with this</SectionLabel>
        <div className="flex flex-col gap-1.5">
          {AGENTS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onRunAgent(key)}
              className="group flex items-start gap-2.5 rounded-[10px] border border-line bg-raised px-2.5 py-2 text-left transition-colors hover:border-brand/40 cursor-pointer"
            >
              <span
                className={cn(
                  'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md',
                  toneSoft[AGENT_TONE[key]],
                  toneText[AGENT_TONE[key]],
                )}
              >
                <Icon name={AGENT_ICON[key]} size={14} />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[12.5px] font-bold text-ink">
                  {AGENT_LABELS[key]}
                  <Icon
                    name="agent"
                    size={11}
                    filled
                    className="text-faint transition-colors group-hover:text-brand"
                  />
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                  {AGENT_RESULT[key]}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Skills ── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <SectionLabel>Skills on</SectionLabel>
          <Link
            to={`${base}/skills`}
            className="setcode ml-auto transition-colors hover:text-brand-deep"
          >
            Manage
          </Link>
        </div>

        {skills.loading ? (
          <Skeleton className="h-14 rounded-[10px]" />
        ) : skillList.length === 0 ? (
          <DashedCard className="px-2.5 py-3.5 text-center">
            <p className="text-[11.5px] leading-snug text-muted">
              No skill on. Answers come back in the default voice.
            </p>
            <Link
              to={`${base}/skills`}
              className="mt-1.5 inline-block text-[11.5px] font-bold text-brand-deep"
            >
              Pick one
            </Link>
          </DashedCard>
        ) : (
          <div className="flex flex-col gap-1.5">
            {skillList.map((skill) => (
              <div
                key={skill.id}
                className={cn(
                  'cardstock flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 ring-1',
                  `ring-${skill.tone}/25`,
                )}
              >
                <span
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-md',
                    toneSoft[skill.tone],
                    toneText[skill.tone],
                  )}
                >
                  <Icon name="skill" size={14} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-bold text-ink">
                    {skill.name}
                  </span>
                  <span className="setcode">Shaping every answer</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Sources ── */}
      <section className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center gap-2">
          <SectionLabel>Sources</SectionLabel>
          <Link
            to={`${base}/docs`}
            className="setcode ml-auto transition-colors hover:text-brand-deep"
          >
            Manage
          </Link>
        </div>

        {docs.loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-12 rounded-[10px]" />
            ))}
          </div>
        ) : docs.error ? (
          <p className="text-[11.5px] text-muted">{docs.error}</p>
        ) : docList.length === 0 ? (
          <DashedCard className="px-2.5 py-3.5 text-center">
            <p className="text-[11.5px] leading-snug text-muted">
              Nothing indexed yet. Answers won't cite anything.
            </p>
            <Link
              to={`${base}/docs`}
              className="mt-1.5 inline-block text-[11.5px] font-bold text-brand-deep"
            >
              Add a document
            </Link>
          </DashedCard>
        ) : (
          <div className="flex flex-col gap-2">
            {docList.map((doc) => (
              <SourceItem key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </section>
    </aside>
  )
}
