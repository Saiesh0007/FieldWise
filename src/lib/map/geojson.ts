/**
 * Pure conversions from FieldWise domain objects to GeoJSON the map layer
 * can render. Kept separate from FieldMap.tsx so the mapping logic can be
 * reasoned about (and, if useful later, tested) without touching MapLibre.
 */
import { circle } from '@turf/turf'
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson'
import type { LocalProjection } from '@/lib/geo/projection'
import type { FieldBoundary, LatLng, NoSprayZone, SprayPass, SprayPlan } from '@/lib/geo/types'
import type { ReplayHeatmap } from '@/lib/simulation/replay'

function ringCoords(vertices: LatLng[]): [number, number][] {
  const coords: [number, number][] = vertices.map((v) => [v.lon, v.lat])
  coords.push(coords[0])
  return coords
}

export function boundaryToPolygonFeature(boundary: FieldBoundary): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: { id: boundary.id },
    geometry: { type: 'Polygon', coordinates: [ringCoords(boundary.vertices)] },
  }
}

/** A plain polygon outline from a vertex ring — for boundaries that aren't a full FieldBoundary (e.g. the Simulate panel's ground-truth/scenario polygons, which have no provenance/edges of their own). */
export function polygonFeatureFromRing(vertices: LatLng[], properties: Record<string, unknown> = {}): Feature<Polygon> {
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Polygon', coordinates: [ringCoords(vertices)] },
  }
}

/** One LineString feature per boundary edge — this is what's individually clickable/selectable on the map. */
export function boundaryEdgesToFeatureCollection(boundary: FieldBoundary): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: boundary.edges.map((edge) => {
      const a = boundary.vertices[edge.fromIndex]
      const b = boundary.vertices[edge.toIndex]
      return {
        type: 'Feature',
        properties: {
          edgeId: edge.id,
          provenance: edge.provenance.kind,
          acceptedRisk: edge.provenance.acceptedRisk === true,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [a.lon, a.lat],
            [b.lon, b.lat],
          ],
        },
      }
    }),
  }
}

export function zonesToFeatureCollection(zones: NoSprayZone[]): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      properties: { id: zone.id, label: zone.label },
      geometry: { type: 'Polygon', coordinates: [ringCoords(zone.vertices)] },
    })),
  }
}

export function latLngPointFeature(point: LatLng): Feature<Point> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
  }
}

export function latLngLineFeature(points: LatLng[]): Feature<LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) },
  }
}

/**
 * Splits a spray plan's passes into two FeatureCollections — spray legs
 * (drawn solid) and transit legs (drawn dashed) — per the rule that these
 * must always be visually distinguishable, not just data-distinguishable.
 */
export function sprayPlanToFeatureCollections(
  plan: SprayPlan,
  projection: LocalProjection,
): { spray: FeatureCollection<LineString>; transit: FeatureCollection<LineString> } {
  const sprayFeatures: Feature<LineString>[] = []
  const transitFeatures: Feature<LineString>[] = []

  for (const sortie of plan.sorties) {
    for (const pass of sortie.passes) {
      const start = projection.toLatLng(pass.start)
      const end = projection.toLatLng(pass.end)
      const feature: Feature<LineString> = {
        type: 'Feature',
        properties: { sortie: sortie.index, spraying: pass.spraying },
        geometry: {
          type: 'LineString',
          coordinates: [
            [start.lon, start.lat],
            [end.lon, end.lat],
          ],
        },
      }
      ;(pass.spraying ? sprayFeatures : transitFeatures).push(feature)
    }
  }

  return {
    spray: { type: 'FeatureCollection', features: sprayFeatures },
    transit: { type: 'FeatureCollection', features: transitFeatures },
  }
}

/** Plan Splitting (§11.8) — the excluded (deferred-to-a-later-battery) passes, drawn as plain lines regardless of spray/transit. */
export function passesToLineFeatureCollection(passes: SprayPass[], projection: LocalProjection): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: passes.map((pass) => {
      const start = projection.toLatLng(pass.start)
      const end = projection.toLatLng(pass.end)
      return {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [start.lon, start.lat],
            [end.lon, end.lat],
          ],
        },
      }
    }),
  }
}

export function boundsOfLatLng(points: LatLng[]): [[number, number], [number, number]] {
  const lons = points.map((p) => p.lon)
  const lats = points.map((p) => p.lat)
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ]
}

export const EMPTY_FEATURE_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** A circle polygon around a point, radius in meters — used to render the simulated GPS accuracy ring while walking a correction. */
export function accuracyCircleFeature(center: LatLng, radiusM: number): Feature<Polygon> {
  return circle([center.lon, center.lat], radiusM / 1000, { steps: 32, units: 'kilometers' }) as Feature<Polygon>
}

/**
 * Renders the replay heatmap as one small square Polygon per cell (not
 * points/circles) so adjacent covered cells visually merge into a solid
 * painted area, the way a real dose heatmap reads. Only cells with
 * doseOrder <= revealedThroughStep are included — this is what drives
 * the progressive-reveal animation — except 'missed' cells (never
 * dosed by any pass), which only appear once revealedThroughStep has
 * reached the end of the pass sequence, so the story reads as "spraying
 * happens, then whatever never got reached lights up red".
 */
export function heatmapToFeatureCollection(
  heatmap: ReplayHeatmap,
  projection: LocalProjection,
  revealedThroughStep: number,
): FeatureCollection<Polygon> {
  const half = heatmap.cellSizeM / 2
  const showMissed = revealedThroughStep >= heatmap.totalPasses - 1

  const features: Feature<Polygon>[] = []
  for (const cell of heatmap.cells) {
    if (cell.state === 'missed') {
      if (!showMissed) continue
    } else if (cell.doseOrder === null || cell.doseOrder > revealedThroughStep) {
      continue
    }

    const corners: LatLng[] = [
      { lon: cell.cx - half, lat: cell.cy - half },
      { lon: cell.cx + half, lat: cell.cy - half },
      { lon: cell.cx + half, lat: cell.cy + half },
      { lon: cell.cx - half, lat: cell.cy + half },
    ].map((p) => projection.toLatLng({ x: p.lon, y: p.lat }))

    features.push({
      type: 'Feature',
      properties: { state: cell.state },
      geometry: { type: 'Polygon', coordinates: [ringCoords(corners)] },
    })
  }

  return { type: 'FeatureCollection', features }
}
