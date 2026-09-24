/**
 * Fits a set of local-meter points into a square SVG viewport — used by
 * the phone-frame mini-map (a schematic of the reference edge + the live
 * walk trace, not a real tile-backed map) so it auto-scales to whatever
 * the pilot has walked so far instead of a fixed, easily-outgrown scale.
 * Pure and separate from FieldMap.tsx so the fit/flip math can be
 * reasoned about (and tested) on its own.
 */
import type { LocalPoint } from '@/lib/geo/types'

export interface ViewportPoint {
  x: number
  y: number
}

/**
 * Returns a projector from local meters to viewport pixels, auto-scaled
 * and centered so every input point lands within `padding` of the
 * viewport edge. Flips Y (local "north" is +y; SVG "down" is +y) so the
 * mini-map reads the same up/down sense a real map would.
 */
export function fitLocalPointsToViewport(points: LocalPoint[], size: number, padding: number): (p: LocalPoint) => ViewportPoint {
  if (points.length === 0) {
    return () => ({ x: size / 2, y: size / 2 })
  }

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  // A single point (or a set of coincident ones) has zero span — floor it
  // so scale computation below never divides by zero.
  const spanX = Math.max(maxX - minX, 1e-6)
  const spanY = Math.max(maxY - minY, 1e-6)
  const usable = size - padding * 2
  const scale = Math.min(usable / spanX, usable / spanY)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  return (p) => ({
    x: size / 2 + (p.x - cx) * scale,
    y: size / 2 - (p.y - cy) * scale,
  })
}
