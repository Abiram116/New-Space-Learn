/**
 * Right-hand dock in Chat: shows sources for this subspace and the agent tiles.
 *
 * The dock is intentionally read-only for docs (real management lives in the
 * Docs tab). Agent tiles hand off to the chat page's `onRunAgent` so the
 * composer stays the one place that starts a workflow.
 */

import { Link } from 'react-router-dom'
import { useState } from 'react'
import { listDocuments } from '../../api/documents'
import { listActiveSkills } from '../../api/skills'
import { useAsync } from '../../lib/useAsync'
import { cn } from '../../lib/cn'
import { toneSoft } from '../../lib/tone'
import { SectionLabel } from '../../components/ui/Bits'
import { DashedCard } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { SourceItem } from '../docs/SourceItem'
import { AGENT_LABELS, type AgentKey } from './agents'

const agentTiles: { key: AgentKey; icon: string; tone: 'brand' | 'sky' | 'sun' | 'mint' }[] = [
  { key: 'notes', icon: '📝', tone: 'brand' },
  { key: 'quiz', icon: '❓', tone: 'sky' },
  { key: 'flashcards', icon: '🗂', tone: 'sun' },
  { key: 'skills', icon: '🎯', tone: 'mint' },
]

export function ContextDock({
  subspaceId,
  base,
  onRunAgent,
}: {
  subspaceId: string
  base: string
  onRunAgent: (agent: AgentKey) => void
}) {
  const [tab, setTab] = useState<'sources' | 'agents'>('sources')
  const docs = useAsync(() => listDocuments(subspaceId), [subspaceId])
  const skills = useAsync(() => listActiveSkills(subspaceId), [subspaceId])

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col gap-3 overflow-y-auto border-l-[1.5px] border-line bg-surface p-3.5 lg:flex">
      <div className="flex gap-1.5 text-xs">
        {(['sources', 'agents'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'rounded-[9px] px-2.5 py-1.5 capitalize transition-colors cursor-pointer',
              tab === key ? 'bg-brand-soft font-semibold text-brand' : 'text-muted',
            )}
          >
            {key}
          </button>
        ))}
      </div>

      {tab === 'sources' ? (
        <>
          {docs.loading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : docs.error ? (
            <p className="text-xs text-muted">{docs.error}</p>
          ) : (docs.data ?? []).length === 0 ? (
            <DashedCard className="bg-canvas px-2.5 py-4 text-center text-xs text-muted">
              No sources yet.
              <div className="mt-1 text-[11px] text-faint">
                Add PDFs from the Docs tab.
              </div>
            </DashedCard>
          ) : (
            <div className="flex flex-col gap-2">
              {docs.data!.map((doc) => (
                <SourceItem key={doc.id} doc={doc} />
              ))}
            </div>
          )}
          <Link
            to={`${base}/docs`}
            className="rounded-xl border-[1.5px] border-line px-2.5 py-2 text-center text-xs font-semibold text-brand"
          >
            Manage documents →
          </Link>

          <SectionLabel className="mt-1">RUN AN AGENT</SectionLabel>
          <div className="grid grid-cols-2 gap-2 text-[11.5px]">
            {agentTiles.map((agent) => (
              <button
                key={agent.key}
                onClick={() => onRunAgent(agent.key)}
                className={cn(
                  'rounded-xl px-1.5 py-3 text-center transition-transform hover:scale-[1.03] cursor-pointer',
                  toneSoft[agent.tone],
                )}
              >
                {agent.icon}
                <div className="mt-1 font-semibold">{AGENT_LABELS[agent.key]}</div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <SectionLabel>ACTIVE SKILLS</SectionLabel>
          {skills.loading ? (
            <Skeleton className="h-16" />
          ) : skills.error ? (
            <p className="text-xs text-muted">{skills.error}</p>
          ) : (skills.data ?? []).length === 0 ? (
            <p className="text-xs text-muted">
              No skills active. Turn one on in{' '}
              <Link to={`${base}/skills`} className="text-brand font-semibold">
                Skills
              </Link>.
            </p>
          ) : (
            skills.data!.map((skill) => (
              <div
                key={skill.id}
                className="rounded-xl border-[1.5px] border-line px-2.5 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2 font-semibold">
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-lg',
                      toneSoft[skill.tone],
                    )}
                  >
                    {skill.icon}
                  </span>
                  {skill.name}
                </div>
                {skill.description && (
                  <div className="mt-1 text-[11px] text-muted">{skill.description}</div>
                )}
              </div>
            ))
          )}
          <Link
            to={`${base}/skills`}
            className="rounded-xl bg-brand-soft py-2 text-center text-xs font-semibold text-brand"
          >
            Manage skills →
          </Link>
        </div>
      )}
    </aside>
  )
}
