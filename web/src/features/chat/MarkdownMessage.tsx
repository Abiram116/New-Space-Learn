import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Citation } from '../../api/types'
import { cn } from '../../lib/cn'
import './chat.css'

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
  streaming = false,
  onCite,
}: {
  content: string
  /** Resolves a `[[n]]` marker to the document it cites, so the badge can
   *  link into Docs the same way NoteEditor's own citation links already
   *  do — without this the marker was styled to look clickable but did
   *  nothing at all. */
  citations?: Citation[]
  base?: string
  /** True on the live bubble: turns on the block reveal animation. */
  streaming?: boolean
  /** Opens the cited passage. Without it a badge falls back to a link into Docs. */
  onCite?: (citation: Citation) => void
}) {
  const { text: withCiteLinks, math } = useMemo(() => extractMath(content), [content])
  const byMarker = useMemo(() => new Map(citations.map((c) => [String(c.marker), c])), [citations])
  // Stable across frames: a new `components` identity would remount every
  // link and code block on each streamed frame. Math travels via context for
  // the same reason.
  const components = useMemo(() => buildComponents(byMarker, base, onCite), [byMarker, base, onCite])
  const rehypePlugins = useHighlighter(HAS_CODE_FENCE.test(content))
  return (
    <MathContext.Provider value={math}>
      <div className={cn('chat-md chat-reply', streaming && 'is-streaming')}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={rehypePlugins}
          components={components}
        >
          {withCiteLinks.replace(/\[\[(\d+)\]\]/g, '[$1](#cite-$1)')}
        </ReactMarkdown>
      </div>
    </MathContext.Provider>
  )
}

/**
 * LaTeX in a reply. The prompt asks for `\( … \)` inline and `\[ … \]`
 * display — the same delimiters the note editor already renders — but
 * markdown would eat those backslashes, so each span is swapped for a
 * placeholder link (`#math-<i>`) before parsing and drawn as KaTeX by the
 * `a` renderer. Fenced code and inline code are left alone.
 */
type MathPart = { latex: string; display: boolean }

const MATH_OR_CODE = /(```[\s\S]*?(?:```|$))|(`[^`\n]*`)|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g

export function extractMath(content: string): { text: string; math: MathPart[] } {
  if (!content.includes('\\')) return { text: content, math: [] }
  const math: MathPart[] = []
  const text = content.replace(
    MATH_OR_CODE,
    (whole, fence?: string, code?: string, block?: string, inline?: string) => {
      if (fence || code) return whole
      const latex = (block ?? inline ?? '').trim()
      if (!latex) return whole
      math.push({ latex, display: block !== undefined })
      return `[math](#math-${math.length - 1})`
    },
  )
  return { text, math }
}

const MathContext = createContext<MathPart[]>([])

let katexMod: typeof import('katex').default | null = null
let katexLoading: Promise<void> | null = null

/** Fire-and-forget: until it lands the formula shows as its LaTeX source. */
function useKatex(): typeof import('katex').default | null {
  const [mod, setMod] = useState(katexMod)
  useEffect(() => {
    if (mod) return
    let live = true
    katexLoading ??= Promise.all([
      import('katex/dist/katex.min.css').catch(() => {}),
      import('katex').then((m) => {
        katexMod = m.default
      }),
    ]).then(() => {})
    katexLoading.then(
      () => live && setMod(katexMod),
      () => {},
    )
    return () => {
      live = false
    }
  }, [mod])
  return mod
}

function MathView({ index }: { index: number }) {
  const spans = useContext(MathContext)
  const span = spans[index]
  const katex = useKatex()
  const html = useMemo(() => {
    if (!katex || !span) return null
    try {
      return katex.renderToString(span.latex, {
        displayMode: span.display,
        throwOnError: false,
        trust: false,
      })
    } catch {
      return null
    }
  }, [katex, span])
  if (!span) return null
  if (html === null) return <code>{span.latex}</code>
  return (
    <span
      className={span.display ? 'chat-math-block' : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Syntax highlighting, fetched only once a reply actually contains a code
 * block. `rehype-highlight` drags in lowlight + highlight.js's common
 * grammars (~377K of source) — the heaviest thing in chat — yet most study
 * answers are prose. Same pattern as `mathPreview.ts`'s katex: until it
 * lands the block renders plain (still monospace, still copyable), then
 * re-renders highlighted. One module-level promise, shared by every message.
 */
type PluggableList = NonNullable<Options['rehypePlugins']>

const HAS_CODE_FENCE = /^\s*(```|~~~)/m
const NO_PLUGINS: PluggableList = []
let highlightPlugins: PluggableList | null = null
let highlightLoading: Promise<PluggableList> | null = null

function loadHighlighter(): Promise<PluggableList> {
  highlightLoading ??= import('rehype-highlight').then((m) => {
    highlightPlugins = [[m.default, { detect: true, ignoreMissing: true }]]
    return highlightPlugins
  })
  return highlightLoading
}

function useHighlighter(needed: boolean): PluggableList {
  const [plugins, setPlugins] = useState(highlightPlugins)
  useEffect(() => {
    if (!needed || plugins) return
    let live = true
    // A failed chunk load leaves code unhighlighted — never breaks the reply.
    loadHighlighter().then((p) => live && setPlugins(p), () => {})
    return () => {
      live = false
    }
  }, [needed, plugins])
  return (needed && plugins) || NO_PLUGINS
}

function buildComponents(byMarker: Map<string, Citation>, base?: string, onCite?: (citation: Citation) => void): Components {
  return {
    a({ href, children, ...props }) {
      if (href?.startsWith('#math-')) {
        return <MathView index={Number(href.slice('#math-'.length))} />
      }
      if (href?.startsWith('#cite-')) {
        const marker = href.slice('#cite-'.length)
        const citation = byMarker.get(marker)
        const badgeClass =
          'ml-0.5 rounded-md bg-brand-soft px-1.5 py-px align-baseline text-[12.5px] font-bold leading-none text-brand-deep no-underline'
        // No link when the marker doesn't resolve to a real citation (a
        // model occasionally emits `[[n]]` for an `n` outside the list it
        // was given) or `base` isn't known yet (the streaming bubble) —
        // still shown as the same badge, just not clickable.
        if (citation && onCite) {
          return (
            <button
              type="button"
              onClick={() => onCite(citation)}
              title={`${citation.document_name} · ${citation.locator}`}
              className={cn(badgeClass, 'cursor-pointer transition-colors hover:bg-brand/30')}
            >
              {children}
            </button>
          )
        }
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
    // Wide tables scroll inside their own frame instead of squashing columns
    // or pushing the page sideways.
    table({ children }) {
      return (
        <div className="chat-table">
          <table>{children}</table>
        </div>
      )
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
    <div className="chat-code group relative">
      {lang && (
        <span className="absolute right-3 top-2 text-[11.5px] font-semibold uppercase tracking-wide text-white/40">
          {lang}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        className="absolute right-2.5 bottom-2 cursor-pointer rounded-md bg-white/10 px-2.5 py-1 text-[12.5px] font-semibold text-white/70 opacity-0 transition-opacity hover:bg-white/20 hover:text-white focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
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
