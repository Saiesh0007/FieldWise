/**
 * No-spray zone handling: the "sprayable area" is the field boundary minus
 * every exclusion zone, computed as a proper polygon boolean difference
 * (not a cheap "skip points inside the zone" hack) so zones that overlap
 * the field edge, or sit entirely inside it and punch a hole, are both
 * handled correctly.
 */
import polygonClipping, { type MultiPolygon as PCMultiPolygon, type Polygon as PCPolygon } from 'polygon-clipping'
import type { LocalPoint } from './types'

/** A closed ring, "open" convention — no repeated closing vertex. */
export type Ring = LocalPoint[]

/** A polygon possibly with holes: [outerRing, ...holeRings]. */
export type LocalPolygon = Ring[]

function toPosition(ring: Ring): [number, number][] {
  const positions: [number, number][] = ring.map((p) => [p.x, p.y])
  const first = positions[0]
  const last = positions[positions.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) positions.push(first)
  return positions
}

function toLocalRing(positions: [number, number][]): LocalPoint[] {
  const pts = positions.map(([x, y]) => ({ x, y }))
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (pts.length > 1 && first.x === last.x && first.y === last.y) pts.pop() // drop closing duplicate
  return pts
}

/**
 * Sprayable area = field boundary minus every no-spray zone, as a
 * MultiPolygon: it can legitimately split into several disjoint pieces
 * (a zone cutting the field in two), or gain a hole (a zone entirely
 * inside the field, like a pond). Feeds both coverage-area stats and the
 * planner's sweep-line clipping.
 */
export function subtractNoSprayZones(boundary: Ring, zones: Ring[]): LocalPolygon[] {
  if (zones.length === 0) return [[boundary]]

  const subject: PCPolygon = [toPosition(boundary)]
  const clips: PCMultiPolygon = zones.map((z) => [toPosition(z)])

  const result = polygonClipping.difference(subject, ...clips)

  return result.map((polygon) => polygon.map((ring) => toLocalRing(ring)))
}

/** Net sprayable area in m² across every polygon and hole in a MultiPolygon. */
export function multiPolygonAreaM2(polys: LocalPolygon[], areaFn: (ring: Ring) => number): number {
  return polys.reduce((sum, poly) => {
    const [outer, ...holes] = poly
    const outerArea = areaFn(outer)
    const holesArea = holes.reduce((s, h) => s + areaFn(h), 0)
    return sum + outerArea - holesArea
  }, 0)
}
