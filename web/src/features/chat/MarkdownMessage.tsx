import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Citation } from '../../api/types'
import { cn } from '../../lib/cn'

/**
 * Renders assistant replies as markdown (bold, lists, tables, fenced code
 * with language highlighting) while keeping our own `[[n]]` citation markers
 * working.
 *
 * Citation markers are converted to markdown link syntax (`[n](#cite-n)`)
 * before parsing, then the `a` renderer below intercepts anything pointing
 * at `#cite-` and swaps in the citation badge. This keeps everything inside
 * markdown's own grammar — no `rehype-raw`, so nothing the model outputs is
 * ever interpreted as literal HTML.
 */
export function MarkdownMessage({
  content,
  citations = [],
  base,
}: {
  content: string
  /** Resolves a `[[n]]` marker to the document it cites, so the badge can
   *  link into Docs the same way NoteEditor's own citation links already
   *  do — without this the marker was styled to look clickable but did
   *  nothing at all. */
  citations?: Citation[]
  base?: string
}) {
  const withCiteLinks = content.replace(/\[\[(\d+)\]\]/g, '[$1](#cite-$1)')
  const byMarker = useMemo(() => new Map(citations.map((c) => [String(c.marker), c])), [citations])
  const components = useMemo(() => buildComponents(byMarker, base), [byMarker, base])
  return (
    <div className="chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {withCiteLinks}
      </ReactMarkdown>
    </div>
  )
}

function buildComponents(byMarker: Map<string, Citation>, base?: string): Components {
  return {
    a({ href, children, ...props }) {
      if (href?.startsWith('#cite-')) {
        const marker = href.slice('#cite-'.length)
        const citation = byMarker.get(marker)
        const badgeClass =
          'ml-0.5 rounded-md bg-brand-soft px-1.5 py-px text-[11px] font-bold text-brand-deep'
        // No link when the marker doesn't resolve to a real citation (a
        // model occasionally emits `[[n]]` for an `n` outside the list it
        // was given) or `base` isn't known yet (the streaming bubble) —
        // still shown as the same badge, just not clickable.
        if (citation && base) {
          return (
            <Link
              to={`${base}/docs?d=${citation.document_id}`}
              title={citation.document_name}
              className={cn(badgeClass, 'cursor-pointer transition-colors hover:bg-brand/30')}
            >
              {children}
            </Link>
          )
        }
        return <span className={badgeClass}>{children}</span>
      }
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
          {children}
        </a>
      )
    },
    pre({ children, ...props }) {
      return <CodeBlock {...props}>{children}</CodeBlock>
    },
  }
}

/** Wraps `<pre>` so we can add a language chip and a copy button. */
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)

  const lang = extractLanguage(children)
  const text = extractText(children)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be denied by the browser; failing silently here beats
      // surfacing a toast over something this low-stakes.
    }
  }

  return (
    <div className="group relative">
      {lang && (
        <span className="absolute right-2.5 top-2 text-[10px] font-semibold uppercase tracking-wide text-white/40">
          {lang}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        className="absolute right-2.5 bottom-2 rounded-md bg-white/10 px-2 py-1 text-[10.5px] font-semibold text-white/70 opacity-0 transition-opacity hover:bg-white/20 hover:text-white group-hover:opacity-100"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre>{children}</pre>
    </div>
  )
}

function extractLanguage(node: React.ReactNode): string | null {
  const cls = firstChildClassName(node)
  const match = cls?.match(/language-(\w+)/)
  return match ? match[1] : null
}

function firstChildClassName(node: React.ReactNode): string | undefined {
  if (
    node &&
    typeof node === 'object' &&
    'props' in node &&
    node.props &&
    typeof node.props === 'object'
  ) {
    const props = node.props as { className?: string }
    return props.className
  }
  return undefined
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: React.ReactNode } }).props
    return extractText(props?.children)
  }
  return ''
}
