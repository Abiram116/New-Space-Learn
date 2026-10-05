/**
 * Linked topics, drawn as a small constellation: this topic in the middle, the
 * topics it is linked to around it in their subjects' colours, and a dashed
 * "Link a topic" node to add one. It replaces a folded row nobody opened —
 * linking is the one setting that changes where answers come from, so it
 * earns a picture that shows exactly that: lines running into this topic.
 *
 * Same three endpoints as `RelatedTopics` (through `useSubspaceLinks`): a
 * node opens its topic, the + node links one, and Edit lists every link with
 * an Unlink button — which is also the plain, keyboard-friendly list.
 *
 * Motion is transform and opacity only (see `linkedTopics.css`) and stops
 * under reduced motion; the graph is decoration over a real `<ul>` of buttons,
 * so a screen reader hears a list of topics, not a drawing.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { subspacePath } from '../../lib/nav'
import { toneDot, toneHex, toneSoft, toneText } from '../../lib/tone'
import { useSubspaceLinks, type LinkedTopic } from '../spaces/useSubspaceLinks'
import { DockHeadButton, DockSectionHead } from './dockParts'
import './linkedTopics.css'

/** How many linked topics the map draws before "+N more". */
const MAX_SHOWN = 6
/** An orbit node's diameter, px. */
const NODE = 42
/** How wide a node's name may run under it, px. */
const LABEL_W = 96

/** Two letters for a node: "Linear Algebra" → "LA", "Optics" → "OP". */
function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
  if (words.length === 0) return name.trim().slice(0, 2).toUpperCase() || '?'
  const a = words[0][0] ?? ''
  const b = words.length > 1 ? (words[1][0] ?? '') : (words[0][1] ?? '')
  return (a + b).toUpperCase()
}

/** The stage's width, kept current as the dock is resized. */
function useWidth(ref: React.RefObject<HTMLElement | null>, mounted: boolean, fallback = 300): number {
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setWidth(el.clientWidth || fallback)
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, mounted, fallback])
  return width
}

type Placed = { x: number; y: number; above: boolean }

/**
 * Where everything sits. One link and the + node sit either side of the
 * centre on a line; more go round an ellipse, starting at the left and
 * clockwise, so the + node always closes the ring.
 */
function layout(count: number, width: number) {
  // `count` includes the + node.
  if (count <= 1) {
    const height = 92
    const cy = 38
    return { height, cx: width * 0.34, cy, ring: null, spots: [{ x: width * 0.8, y: cy, above: false }] as Placed[] }
  }
  if (count === 2) {
    const height = 112
    const cx = width / 2
    const cy = 42
    const rx = Math.min(width * 0.36, width / 2 - LABEL_W / 2)
    return {
      height,
      cx,
      cy,
      ring: null,
      spots: [
        { x: cx - rx, y: cy, above: false },
        { x: cx + rx, y: cy, above: false },
      ],
    }
  }
  const height = count <= 3 ? 184 : 212
  const cx = width / 2
  const cy = height / 2
  const ry = height / 2 - 46
  const rx = Math.min(width * 0.38, width / 2 - LABEL_W / 2 + 4)
  const spots: Placed[] = Array.from({ length: count }, (_, i) => {
    const a = ((180 + (360 / count) * i) * Math.PI) / 180
    const sin = Math.sin(a)
    return { x: cx + rx * Math.cos(a), y: cy + ry * sin, above: sin < -0.25 }
  })
  return { height, cx, cy, ring: { rx, ry }, spots }
}

export function DockLinkedTopics({ subspaceId }: { subspaceId: string }) {
  const { linked, candidates, add, remove, spaces } = useSubspaceLinks(subspaceId)
  const navigate = useNavigate()
  const stage = useRef<HTMLDivElement>(null)
  const width = useWidth(stage, linked !== null)
  const [hot, setHot] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  const here = useMemo(() => {
    for (const space of spaces) {
      const sub = space.subspaces.find((s) => s.id === subspaceId)
      if (sub) return { sub, space }
    }
    return null
  }, [spaces, subspaceId])

  // The picker closes on Escape and on a click anywhere else.
  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPicking(false)
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (pickerRef.current?.contains(t)) return
      if ((t as Element).closest?.('[data-link-add]')) return
      setPicking(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [picking])

  const list = linked ?? []
  const shown = list.slice(0, MAX_SHOWN)
  const more = list.length - shown.length
  const { height, cx, cy, ring, spots } = layout(shown.length + 1, width)
  const addSpot = spots[spots.length - 1]
  const hereTone = here?.space.tone ?? 'brand'

  const open = (t: LinkedTopic) => {
    if (t.space) navigate(subspacePath(t.space, t))
  }

  return (
    <section aria-labelledby="dock-linked-label" className="flex flex-col gap-2">
      <DockSectionHead
        id="dock-linked-label"
        hint="When you ask, I also read the files in these topics."
        aside={
          list.length > 0 ? (
            <DockHeadButton onClick={() => setEditing((v) => !v)} aria-expanded={editing} pressed={editing}>
              {editing ? 'Done' : 'Edit'}
            </DockHeadButton>
          ) : undefined
        }
      >
        Linked topics
      </DockSectionHead>

      {linked === null ? (
        <Skeleton className="h-[92px] rounded-[14px]" />
      ) : (
        <div
          ref={stage}
          className="relative w-full rounded-[14px] border border-line bg-well/50"
          style={{ height }}
          onPointerLeave={() => setHot(null)}
        >
          {/* The drawing: orbit, spokes. Decoration only. */}
          <svg aria-hidden className="absolute inset-0" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            {ring && (
              <ellipse
                className="ltm-breathe"
                cx={cx}
                cy={cy}
                rx={ring.rx}
                ry={ring.ry}
                fill="none"
                stroke="var(--color-line-dash)"
                strokeDasharray="2 6"
                strokeLinecap="round"
              />
            )}
            {shown.map((t, i) => (
              <line
                key={t.id}
                className="ltm-spoke-in transition-opacity duration-200"
                style={{ animationDelay: `${80 + i * 70}ms`, opacity: hot && hot !== t.id ? 0.25 : hot === t.id ? 1 : 0.55 }}
                x1={cx}
                y1={cy}
                x2={spots[i].x}
                y2={spots[i].y}
                stroke={toneHex[t.tone]}
                strokeWidth={hot === t.id ? 2.5 : 1.75}
                strokeLinecap="round"
              />
            ))}
            <line
              x1={cx}
              y1={cy}
              x2={addSpot.x}
              y2={addSpot.y}
              stroke="var(--color-line-dash)"
              strokeWidth={1.5}
              strokeDasharray="4 5"
              strokeLinecap="round"
            />
          </svg>

          {/* Sparks running down each spoke into this topic: what a link does. */}
          {shown.map((t, i) => (
            <span
              key={`flow-${t.id}`}
              aria-hidden
              className="ltm-flow pointer-events-none absolute h-1.5 w-1.5 rounded-full"
              style={
                {
                  left: cx - 3,
                  top: cy - 3,
                  background: toneHex[t.tone],
                  boxShadow: `0 0 8px ${toneHex[t.tone]}`,
                  animationDelay: `${700 + i * 450}ms`,
                  '--ltm-fx': `${spots[i].x - cx}px`,
                  '--ltm-fy': `${spots[i].y - cy}px`,
                } as React.CSSProperties
              }
            />
          ))}

          {/* This topic. */}
          <div
            aria-hidden
            className="absolute z-[1] flex max-w-[9.5rem] flex-col items-center rounded-[14px] border border-line bg-surface px-3 py-1.5 text-center shadow-[0_6px_18px_-8px_rgba(0,0,0,0.7)]"
            style={{ left: cx, top: cy, transform: 'translate(-50%, -50%)' }}
          >
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
              <span className={cn('h-2 w-2 rounded-full', toneDot[hereTone])} />
              This topic
            </span>
            <span className="max-w-full truncate text-[13.5px] font-extrabold text-ink">{here?.sub.name ?? 'Here'}</span>
          </div>

          <ul aria-label="Linked topics" className="contents">
            {shown.map((t, i) => {
              const { x, y, above } = spots[i]
              const isHot = hot === t.id
              const align = x < width * 0.28 ? 'start' : x > width * 0.72 ? 'end' : 'center'
              return (
                <li key={t.id} className="contents">
                  <button
                    type="button"
                    onClick={() => open(t)}
                    onPointerEnter={() => setHot(t.id)}
                    onFocus={() => setHot(t.id)}
                    onBlur={() => setHot((h) => (h === t.id ? null : h))}
                    disabled={!t.space}
                    aria-label={`Open ${t.name}${t.space ? ` (${t.space.name})` : ''}`}
                    className={cn(
                      'ltm-node-in absolute z-[2] grid cursor-pointer place-items-center rounded-full ring-2 ring-inset',
                      'text-[13px] font-extrabold tracking-wide transition-transform duration-200',
                      'hover:scale-110 focus-visible:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                      'disabled:cursor-default',
                      toneSoft[t.tone],
                      toneText[t.tone],
                    )}
                    style={
                      {
                        left: x - NODE / 2,
                        top: y - NODE / 2,
                        width: NODE,
                        height: NODE,
                        // The ring in the subject's own colour.
                        ['--tw-ring-color' as string]: `${toneHex[t.tone]}99`,
                        animationDelay: `${60 + i * 70}ms`,
                        '--ltm-dx': `${cx - x}px`,
                        '--ltm-dy': `${cy - y}px`,
                      } as React.CSSProperties
                    }
                  >
                    {initials(t.name)}
                  </button>
                  <NodeLabel x={x} y={y} above={above} align={align} hot={isHot}>
                    <span className="block truncate">{t.name}</span>
                    {isHot && t.space && (
                      <span className="block truncate text-[12px] font-medium text-muted">{t.space.name} · click to open</span>
                    )}
                  </NodeLabel>
                </li>
              )
            })}
            <li className="contents">
              <button
                type="button"
                data-link-add
                onClick={() => setPicking((v) => !v)}
                aria-expanded={picking}
                aria-label="Link a topic"
                className={cn(
                  'absolute z-[2] grid cursor-pointer place-items-center rounded-full border-[1.5px] border-dashed t-control duration-200',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                  picking
                    ? 'border-brand bg-brand-soft text-brand-deep'
                    : 'border-line-dash bg-surface text-ink-3 hover:border-brand hover:text-brand-deep',
                )}
                style={{ left: addSpot.x - NODE / 2, top: addSpot.y - NODE / 2, width: NODE, height: NODE }}
              >
                <Icon name="plus" size={18} />
              </button>
              <NodeLabel
                x={addSpot.x}
                y={addSpot.y}
                above={addSpot.above}
                align={addSpot.x < width * 0.28 ? 'start' : addSpot.x > width * 0.72 ? 'end' : 'center'}
                hot={false}
                muted
              >
                Link a topic
              </NodeLabel>
            </li>
          </ul>
        </div>
      )}

      {more > 0 && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-fit cursor-pointer rounded-md px-1 text-[13px] font-semibold text-muted transition-colors hover:text-ink"
        >
          +{more} more linked
        </button>
      )}

      {picking && (
        <div ref={pickerRef} className="flex flex-col rounded-[12px] border border-line bg-surface p-1.5 shadow-lg">
          <p className="px-2.5 pb-1 pt-1.5 text-[13px] font-bold text-ink-2">Pick a topic to link</p>
          <div className="flex max-h-64 flex-col overflow-y-auto overscroll-contain">
            {candidates.length === 0 && (
              <p className="px-2.5 py-2.5 text-[13.5px] text-muted">No other topics to link yet.</p>
            )}
            {candidates.map((c) => {
              const tone = spaces.find((sp) => sp.id === c.subject_id)?.tone ?? 'sky'
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setPicking(false)
                    void add(c.id)
                  }}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-line-soft"
                >
                  <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', toneDot[tone])} />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{c.name}</span>
                  <span className="shrink-0 truncate text-[12.5px] text-muted">{c.spaceName}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {editing && list.length > 0 && (
        <ul aria-label="Edit linked topics" className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-raised">
          {list.map((t) => (
            <li key={t.id} className="flex min-h-12 items-center gap-2.5 border-b border-line-soft px-3 last:border-b-0">
              <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', toneDot[t.tone])} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-ink">{t.name}</span>
                {t.space && <span className="block truncate text-[12.5px] text-muted">{t.space.name}</span>}
              </span>
              <button
                type="button"
                onClick={() => void remove(t.id)}
                aria-label={`Unlink ${t.name}`}
                className="min-h-9 shrink-0 cursor-pointer rounded-full px-3 text-[13px] font-bold text-muted transition-colors hover:bg-coral-soft hover:text-coral-deep"
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A node's name, under it (or over it, near the top), kept inside the map. */
function NodeLabel({
  x,
  y,
  above,
  align,
  hot,
  muted = false,
  children,
}: {
  x: number
  y: number
  above: boolean
  align: 'start' | 'center' | 'end'
  hot: boolean
  muted?: boolean
  children: React.ReactNode
}) {
  const gap = NODE / 2 + 5
  // Anchored at the node's own edge (or centre), so a long name grows away
  // from the map's edge rather than off it.
  const shift = align === 'start' ? `${-NODE / 2}px` : align === 'end' ? `calc(-100% + ${NODE / 2}px)` : '-50%'
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute text-[12.5px] font-semibold leading-tight transition-colors duration-150',
        align === 'start' ? 'text-left' : align === 'end' ? 'text-right' : 'text-center',
        hot
          ? 'z-[4] w-max max-w-[13.5rem] rounded-lg border border-line bg-canvas px-2 py-1 text-ink shadow-[0_6px_16px_-8px_rgba(0,0,0,0.8)]'
          : cn('z-[3]', muted ? 'text-muted' : 'text-ink-2'),
      )}
      style={{
        left: x,
        width: hot ? undefined : LABEL_W,
        transform: `translateX(${shift})`,
        ...(above ? { bottom: `calc(100% - ${y - gap}px)` } : { top: y + gap }),
      }}
    >
      {children}
    </span>
  )
}
