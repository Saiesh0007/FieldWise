/**
 * LatLng <-> LocalPoint conversion. Every planning algorithm (sweep
 * generation, no-spray clipping, area/length math) operates in LocalPoint
 * space — never in raw lon/lat, where a degree of longitude covers less
 * ground distance than a degree of latitude at any latitude other than
 * the equator, which would silently skew swath spacing and areas.
 */
import proj4 from 'proj4'
import type { LatLng, LocalPoint } from './types'

const LONLAT_WGS84 = '+proj=longlat +datum=WGS84 +no_defs'

export interface LocalProjection {
  origin: LatLng
  toLocal(p: LatLng): LocalPoint
  toLatLng(p: LocalPoint): LatLng
}

/**
 * Arithmetic mean of vertex lon/lat. This is only used to pick where to
 * center the local projection, not as a geometric result in its own
 * right, so the small bias of a plain average (vs. an area-weighted
 * centroid) doesn't matter at field scale — any point near the middle of
 * the field gives a good projection origin.
 */
export function approximateCentroidLatLng(vertices: LatLng[]): LatLng {
  const sum = vertices.reduce(
    (acc, v) => ({ lon: acc.lon + v.lon, lat: acc.lat + v.lat }),
    { lon: 0, lat: 0 },
  )
  return { lon: sum.lon / vertices.length, lat: sum.lat / vertices.length }
}

/**
 * Builds a local azimuthal-equidistant (AEQD) projection centered on
 * `origin`. AEQD preserves true distances (and, at field scale — a few
 * hundred meters to a few kilometers — angles and areas too, to well
 * under 0.1% error) measured from the center point, which is exactly the
 * property sweep-line spacing and edge-length math need.
 */
export function createLocalProjection(origin: LatLng): LocalProjection {
  const def = `+proj=aeqd +lat_0=${origin.lat} +lon_0=${origin.lon} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`
  const converter = proj4(LONLAT_WGS84, def)

  return {
    origin,
    toLocal(p) {
      const [x, y] = converter.forward([p.lon, p.lat])
      return { x, y }
    },
    toLatLng(p) {
      const [lon, lat] = converter.inverse([p.x, p.y])
      return { lon, lat }
    },
  }
}

export function projectAll(projection: LocalProjection, points: LatLng[]): LocalPoint[] {
  return points.map((p) => projection.toLocal(p))
}

export function unprojectAll(projection: LocalProjection, points: LocalPoint[]): LatLng[] {
  return points.map((p) => projection.toLatLng(p))
}

/**
 * The sweep heading (degrees, standard math convention — 0° = east,
 * counter-clockwise) implied by two tapped points along a visible crop
 * row. This is the whole "tap crop-row heading" correction: it only ever
 * feeds a SweepStrategy override, never touches the boundary.
 */
export function headingDegBetween(projection: LocalProjection, a: LatLng, b: LatLng): number {
  const pa = projection.toLocal(a)
  const pb = projection.toLocal(b)
  const rad = Math.atan2(pb.y - pa.y, pb.x - pa.x)
  return ((rad * 180) / Math.PI + 360) % 360
}
