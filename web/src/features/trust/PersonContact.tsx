import { useState } from 'react'
import type { TeamMember } from './config'

/**
 * One person's address: write to them, or copy it. Used on the Contact page
 * and in Settings › About & legal — its own file so Settings does not pull in
 * every page's text to show two email addresses.
 */
export function PersonContact({ person }: { person: TeamMember }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(person.email)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // No clipboard (an insecure origin, an old browser): the address is on screen to select.
    }
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
      <div className="min-w-0">
        <p className="truncate text-[16px] font-semibold text-ink">{person.name}</p>
        <p className="mt-0.5 truncate text-[14.5px] text-ink-2">{person.email}</p>
      </div>
      <div className="flex gap-1.5">
        <a
          href={`mailto:${person.email}`}
          className="inline-flex h-7 items-center rounded-full bg-brand px-3 text-[12.5px] font-bold text-[#1a120f] transition-opacity hover:opacity-90"
        >
          Write
        </a>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex h-7 cursor-pointer items-center rounded-full bg-white/[0.07] px-3 text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-white/[0.12] hover:text-ink"
        >
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  )
}
