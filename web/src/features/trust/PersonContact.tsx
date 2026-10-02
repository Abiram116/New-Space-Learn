import { useState } from 'react'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
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
  // Icon-only, right beside the address they act on. Each still has a name
  // for screen readers and a tooltip for everyone else.
  const icon =
    'grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-white/10 hover:text-ink pointer-coarse:h-10 pointer-coarse:w-10'
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
      <p className="truncate text-[16px] font-semibold text-ink">{person.name}</p>
      <div className="mt-0.5 flex items-center gap-1">
        <p className="min-w-0 truncate text-[14.5px] text-ink-2">{person.email}</p>
        <a href={`mailto:${person.email}`} aria-label="Write" title={`Write to ${person.name}`} className={cn(icon, 'ml-1.5')}>
          <Icon name="send" size={15} />
        </a>
        <button type="button" onClick={() => void copy()} aria-label="Copy" title="Copy the address" className={cn(icon, copied && 'text-jade-deep')}>
          <Icon name={copied ? 'check' : 'copy'} size={15} />
        </button>
        <span role="status" className="sr-only">
          {copied ? 'Copied' : ''}
        </span>
      </div>
    </div>
  )
}
