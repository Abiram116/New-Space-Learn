/**
 * StickyActionBar — a screen's primary action, pinned in the thumb zone.
 *
 *     <div className="min-h-0 flex-1 overflow-y-auto">   ← the screen's scroller
 *       …content…
 *       <StickyActionBar>
 *         <Button size="xl" className="flex-1">Start review</Button>
 *       </StickyActionBar>
 *     </div>
 *
 * API: `children` (the action or actions, laid out in a row with a 10px gap —
 * give the primary `flex-1` to fill the width) and an optional `className`.
 * That is all.
 *
 * Put it LAST inside the element that scrolls. It is `position: sticky`, so it
 * rides the bottom edge of that scroller: directly above the phone tab bar in
 * normal screens, and above the home indicator (safe-area inset) on immersive
 * screens, where the tab bar has stepped aside (`useImmersive`). A soft fade
 * above it keeps scrolling content from reading as cut off.
 *
 * Phone-only styling. On tablet/desktop (see `useIsMobile`) it renders the
 * same children in a plain, un-pinned row so a shared screen can use it
 * unconditionally without changing the wide layout's behaviour.
 */

import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { useIsMobile } from '../../lib/useIsMobile'
import { useIsImmersive } from '../layout/immersive'

export function StickyActionBar({ children, className }: { children: ReactNode; className?: string }) {
  const mobile = useIsMobile()
  const immersive = useIsImmersive()

  if (!mobile) return <div className={cn('flex items-center gap-2.5', className)}>{children}</div>

  return (
    <div
      data-sticky-action-bar=""
      className={cn(
        'sticky bottom-0 z-10 mt-auto flex shrink-0 items-center gap-2.5 px-4 pt-5',
        // Fade from transparent into the ground so content scrolling under it
        // dissolves instead of being sliced by a hard edge.
        'bg-[linear-gradient(to_bottom,transparent,var(--color-canvas)_38%)]',
        immersive ? 'pb-[max(14px,env(safe-area-inset-bottom))]' : 'pb-3.5',
        className,
      )}
    >
      {children}
    </div>
  )
}
