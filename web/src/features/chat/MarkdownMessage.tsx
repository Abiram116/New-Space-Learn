import { useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

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
export function MarkdownMessage({ content }: { content: string }) {
  const withCiteLinks = content.replace(/\[\[(\d+)\]\]/g, '[$1](#cite-$1)')
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

const components: Components = {
  a({ href, children, ...props }) {
    if (href?.startsWith('#cite-')) {
      return (
        <span className="ml-0.5 rounded-md bg-brand-soft px-1.5 py-px text-[11px] font-bold text-brand-deep">
          {children}
        </span>
      )
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
