import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

/**
 * The two materials that are not cardstock.
 *
 * The system has three surfaces, and which one you reach for is a statement
 * about what the thing IS, not how it should look:
 *
 *   <Card>    things you OWN      — decks, cards, badges, topics, sources
 *   <Leaf>    things you READ     — notes, assistant prose, question stems
 *   <Ledger>  things you're MEASURED against — streak, forecast, scores
 *
 * One-line test: cardstock is a thing you have; a leaf is a thing you're
 * inside; a ledger is a thing you're measured against.
 *
 * Before this existed, `.cardstock` did all three jobs — so a paragraph you
 * were reading, a note you were writing, and six months of activity all
 * rendered as the same object resting on a table.
 */

/**
 * A sheet on the drafting table. Defined by its margin rule and its measure,
 * never by a box — so it takes no border, no gradient and no shadow, and it
 * never lifts. Pass `measure` for running prose to cap the line at 66ch.
 */
export function Leaf({
  className,
  measure = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { measure?: boolean }) {
  return <div className={cn('leaf', measure && 'leaf-measure', className)} {...props} />
}

/**
 * Ruled stock for figures. Numbers sit ON the rule rather than inside a box,
 * and digits align in columns.
 *
 * `datum` draws the reference line — a goal, an average, a zero. Reach for it
 * whenever the reader needs to judge a value against something: without a
 * reference, a bar chart is decoration, because there is nothing to compare
 * the height to.
 */
export function Ledger({
  className,
  datum = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { datum?: boolean }) {
  return <div className={cn('ruled', datum && 'ruled-datum', className)} {...props} />
}
