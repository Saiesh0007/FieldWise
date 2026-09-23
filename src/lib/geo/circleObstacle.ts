/**
 * Circle-shaped obstacle support (AeroGCS Green parity): "Add Obstacle"
 * lets a pilot mark an exclusion zone as a center point + radius instead
 * of drawing a freehand polygon. Everywhere downstream — differencing,
 * planning, export, map rendering — only ever deals in polygons, so a
 * circle is converted to a regular closed ring once, here, and then
 * flows through exactly the same NoSprayZone machinery a hand-drawn
 * zone does.
 */
import { circle as turfCircle } from '@turf/turf'
import type { LatLng } from './types'

/** Vertex count for the circle's polygon approximation — matches the pilot-accuracy ring elsewhere in the app. */
export const CIRCLE_SEGMENTS = 32

/**
 * Converts a circle (center + radius in meters) into a closed polygon
 * ring of LatLng vertices, "open" convention (no repeated closing
 * vertex) — the same convention every other polygon in the app uses
 * (FieldBoundary.vertices, NoSprayZone.vertices). Uses turf's geodesic
 * circle so the radius is accurate regardless of latitude.
 */
export function circleToPolygon(center: LatLng, radiusM: number, steps = CIRCLE_SEGMENTS): LatLng[] {
  if (radiusM <= 0) throw new Error('Circle radius must be a positive number of meters.')

  const feature = turfCircle([center.lon, center.lat], radiusM / 1000, { steps, units: 'kilometers' })
  const ring = feature.geometry.coordinates[0]
  // turf closes the ring (first === last); every polygon in this app is stored open.
  return ring.slice(0, -1).map(([lon, lat]) => ({ lon, lat }))
}
