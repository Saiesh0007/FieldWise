/**
 * The demo's "Load sample field" preset. This is the exact same
 * L-shaped field + pond geometry as scenario.test.ts (same edge lengths,
 * area, sweep plan — verified by the geometry-core test suite), just
 * relocated: it originally sat over a residential area near Mysuru,
 * which looks wrong on screen for an agri-spray demo. Real farmland was
 * checked directly against Esri World Imagery tiles (the same tile
 * source the map uses) before picking this spot — visibly divided crop
 * plots near Moga, Punjab.
 *
 * The relocation preserves the shape exactly: the old vertices were
 * projected to local meters around their old centroid, then those same
 * local points were re-projected to lat/lng around the new origin (see
 * git history for the one-off script that did this) — so this is a
 * translation, not a redraw, and every number the test suite already
 * verified (area, edge lengths, sortie count, etc.) still holds.
 */
import { createBoundary } from './boundary'
import type { FieldBoundary, LatLng, NoSprayZone, SweepStrategy } from './types'

export const SAMPLE_FIELD_VERTICES: LatLng[] = [
  { lon: 75.748491, lat: 30.349069 },
  { lon: 75.75132, lat: 30.349069 },
  { lon: 75.75132, lat: 30.350067 },
  { lon: 75.750189, lat: 30.350067 },
  { lon: 75.750189, lat: 30.350865 },
  { lon: 75.748491, lat: 30.350865 },
]

export const SAMPLE_POND_VERTICES: LatLng[] = [
  { lon: 75.749057, lat: 30.349268 },
  { lon: 75.749623, lat: 30.349268 },
  { lon: 75.749623, lat: 30.349667 },
  { lon: 75.749057, lat: 30.349667 },
]

/** The centroid of the sample field — used as the map's initial camera target. */
export const SAMPLE_FIELD_CENTER: LatLng = { lon: 75.75, lat: 30.35 }

export interface SampleFieldPreset {
  boundary: FieldBoundary
  noSprayZones: NoSprayZone[]
  sweepStrategy: SweepStrategy
}

export function loadSampleField(): SampleFieldPreset {
  const boundary = createBoundary(SAMPLE_FIELD_VERTICES, 'satellite-trace', { imageryDate: '2024-11-01' })

  // The notch's closing edge (v4 -> v5) is pre-marked as walked, standing
  // in for "the pilot already corrected this edge" — so the readiness
  // gate has something real to show (partially cleared) without first
  // requiring a live correction pass.
  const walkedEdge = boundary.edges.find((e) => e.fromIndex === 4 && e.toIndex === 5)
  if (walkedEdge) {
    walkedEdge.provenance = { kind: 'walked', accuracyM: 2.1, verifiedAt: new Date().toISOString() }
  }

  const noSprayZones: NoSprayZone[] = [{ id: 'pond-1', label: 'Pond', vertices: SAMPLE_POND_VERTICES }]

  return {
    boundary,
    noSprayZones,
    sweepStrategy: { kind: 'min-turns' },
  }
}
