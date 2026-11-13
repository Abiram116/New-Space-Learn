import type { CSSProperties } from 'react'
import { Icon, type IconName } from './Icon'
import { cn } from '../../lib/cn'

/**
 * A dimensional version of an icon from the drawn set.
 *
 * Why this rather than a 3D icon pack: the app's icons are hand-drawn glyphs
 * on a 24px grid at `strokeWidth 1.6`, and they read as one family. Dropping
 * rendered 3D assets into the rail would clash with every other icon in the
 * product, and a raster 3D icon at 16px is mud — the detail that makes it look
 * three-dimensional is smaller than a pixel.
 *
 * So the depth is constructed, from copies of the same vector glyph:
 *
 *   1. a CONTACT SHADOW — only once the icon is lifted off the surface
 *   2. the EXTRUSION — a few copies stepped down-right, each a darker shade
 *      of the icon's own colour, so the side wall is one continuous solid
 *      (a single offset copy reads as a double print, not as depth)
 *   3. a RIM — the chamfer between side and face, catching a little light
 *   4. the FACE, full strength, inheriting the surrounding colour
 *   5. a SHEEN — the face again in white, masked to the upper-left, where the
 *      lamp the rest of the product is lit by would catch it
 *
 * Still vector, so it is crisp at any size, and depth scales with the glyph so
 * it looks the same at 14px and 28px.
 *
 * `lifted` deepens the extrusion and floats the face — the active rail item,
 * an empty state's mark. Inside anything you can point at (a link, a button,
 * or an element with `.icon3d-host`) the icon also tilts toward you and lifts
 * a little further on hover and keyboard focus; under reduced motion it lifts
 * without moving. All of that is CSS (`.icon3d` in index.css): no listeners,
 * no re-renders.
 */
export function Icon3D({
  name,
  size = 16,
  lifted = false,
  className,
}: {
  name: IconName
  size?: number
  lifted?: boolean
  className?: string
}) {
  // Depth at rest, in px; ~1.4px at 16px, ~2.4px at 28px.
  const depth = 0.085 * size
  // Enough steps that the wall reads as solid, never more than five.
  const steps = Math.max(2, Math.min(5, Math.round(depth / 0.55)))
  const glyph = <Icon name={name} size={size} />

  return (
    <span
      className={cn('icon3d', className)}
      data-lifted={lifted ? '' : undefined}
      style={{ width: size, height: size, '--icon3d-s': `${size}px`, '--icon3d-d': `${depth.toFixed(2)}px` } as CSSProperties}
      aria-hidden
    >
      <span className="icon3d-shadow" />
      {Array.from({ length: steps }, (_, i) => {
        // Furthest first, so nearer steps paint over it.
        const k = (steps - i) / steps
        return (
          <span key={i} className={cn('icon3d-wall', i === steps - 1 && 'icon3d-rim')} style={{ '--k': k.toFixed(3) } as CSSProperties}>
            {glyph}
          </span>
        )
      })}
      <span className="icon3d-face">{glyph}</span>
      <span className="icon3d-sheen">{glyph}</span>
    </span>
  )
}
