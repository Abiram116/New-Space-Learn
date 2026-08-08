import { Icon, type IconName } from './Icon'
import { cn } from '../../lib/cn'

/**
 * A dimensional version of an icon from the drawn set.
 *
 * Why this rather than a 3D icon pack: the app's icons are 33 hand-drawn
 * glyphs on a 24px grid at `strokeWidth 1.6`, and they read as one family.
 * Dropping rendered 3D assets into the rail would clash with every other icon
 * in the product, and a raster 3D icon at 16px is mud — the detail that makes
 * it look three-dimensional is smaller than a pixel.
 *
 * So the depth is constructed instead. Three stacked copies of the same glyph:
 *
 *   1. an EXTRUSION offset down-right in a dark tone — the body of the shape
 *   2. a RIM offset by half that, catching a little warmth
 *   3. the FACE, unshifted and full strength
 *
 * That is genuinely how a lit, extruded object resolves, and because it is
 * still vector it stays crisp at any size. The light comes from the upper
 * left, matching the lamp the rest of the product is lit by.
 *
 * `lifted` deepens the extrusion and floats the face — used for the active
 * rail item, so the current page reads as physically raised off the surface.
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
  // Depth scales with the glyph so it looks the same at 16px and 28px.
  const d = (lifted ? 0.11 : 0.07) * size

  return (
    <span
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* Extrusion — the side of the solid, furthest from the light. */}
      <span
        className="pointer-events-none absolute inset-0 grid place-items-center text-well transition-transform duration-300"
        style={{ transform: `translate(${d}px, ${d}px)`, opacity: 0.85 }}
      >
        <Icon name={name} size={size} />
      </span>

      {/* Rim — the chamfer between side and face, picking up a little warmth. */}
      <span
        className="pointer-events-none absolute inset-0 grid place-items-center text-ink/20 transition-transform duration-300"
        style={{ transform: `translate(${d / 2}px, ${d / 2}px)` }}
      >
        <Icon name={name} size={size} />
      </span>

      {/* Face — full strength, inherits the link's own colour so active and
          hover states still drive it. */}
      <span
        className="relative grid place-items-center transition-transform duration-300"
        style={{ transform: lifted ? `translate(${-d / 3}px, ${-d / 3}px)` : undefined }}
      >
        <Icon name={name} size={size} />
      </span>
    </span>
  )
}
