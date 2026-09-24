/**
 * Boundary file import — GeoJSON and KML, single-polygon support (takes
 * the first Polygon/MultiPolygon geometry found). This is deliberately
 * minimal: services that already have a boundary file just need it read
 * in as a starting prior, exactly as untrusted as a freshly-traced
 * satellite boundary — it still goes through the same verification gate.
 */
import type { MultiPolygon, Polygon, Position } from 'geojson'
import type { LatLng } from './types'

export class BoundaryImportError extends Error {}

function dropClosingDuplicate<T extends { lon: number; lat: number }>(points: T[]): T[] {
  if (points.length > 1) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first.lon === last.lon && first.lat === last.lat) return points.slice(0, -1)
  }
  return points
}

function positionsToLatLng(ring: Position[]): LatLng[] {
  const points = ring.map(([lon, lat]) => ({ lon, lat }))
  const deduped = dropClosingDuplicate(points)
  if (deduped.length < 3) throw new BoundaryImportError('Polygon needs at least 3 vertices.')
  return deduped
}

function findFirstPolygonRing(node: unknown): Position[] | null {
  if (!node || typeof node !== 'object') return null
  const obj = node as { type?: string; features?: unknown[]; geometry?: unknown }

  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    for (const feature of obj.features) {
      const ring = findFirstPolygonRing(feature)
      if (ring) return ring
    }
    return null
  }
  if (obj.type === 'Feature') return findFirstPolygonRing(obj.geometry)
  if (obj.type === 'Polygon') return (obj as unknown as Polygon).coordinates[0] ?? null
  if (obj.type === 'MultiPolygon') return (obj as unknown as MultiPolygon).coordinates[0]?.[0] ?? null
  return null
}

export function parseGeoJSONBoundary(text: string): LatLng[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new BoundaryImportError('Not valid JSON.')
  }

  const ring = findFirstPolygonRing(json)
  if (!ring) throw new BoundaryImportError('No Polygon or MultiPolygon geometry found in this GeoJSON.')
  return positionsToLatLng(ring)
}

export function parseKmlBoundary(text: string): LatLng[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) throw new BoundaryImportError('Could not parse this file as XML/KML.')

  const coordsEl =
    doc.querySelector('Polygon outerBoundaryIs LinearRing coordinates') ??
    doc.querySelector('LinearRing coordinates') ??
    doc.querySelector('coordinates')

  if (!coordsEl?.textContent) throw new BoundaryImportError('No <coordinates> element found in this KML.')

  const points = coordsEl.textContent
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const [lon, lat] = tuple.split(',').map(Number)
      return { lon, lat }
    })
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))

  const deduped = dropClosingDuplicate(points)
  if (deduped.length < 3) throw new BoundaryImportError('Polygon needs at least 3 vertices.')
  return deduped
}

export function parseBoundaryFile(filename: string, text: string): LatLng[] {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.kml')) return parseKmlBoundary(text)
  if (lower.endsWith('.geojson') || lower.endsWith('.json')) return parseGeoJSONBoundary(text)

  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return parseGeoJSONBoundary(text)
  if (trimmed.startsWith('<')) return parseKmlBoundary(text)
  throw new BoundaryImportError('Unrecognized file type — expected .geojson, .json, or .kml.')
}
