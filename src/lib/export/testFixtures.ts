/**
 * Shared small field fixture for the export unit tests — a 100m x 50m
 * rectangle boundary (four edges: two satellite, one walked, one
 * satellite-with-accepted-risk) plus one no-spray zone, projected around
 * a fixed lat/lon origin so tests are deterministic. Not used by any
 * runtime code, test-only.
 */
import { createBoundary } from '@/lib/geo/boundary'
import { DEFAULT_DRONE_PROFILE } from '@/lib/geo/defaults'
import { planSprayPath } from '@/lib/geo/planner'
import { createLocalProjection, projectAll } from '@/lib/geo/projection'
import { computeReadiness } from '@/lib/geo/readiness'
import type { DroneProfile, FieldBoundary, LatLng, NoSprayZone, SprayPlan } from '@/lib/geo/types'

export const FIXTURE_ORIGIN: LatLng = { lon: 75.75, lat: 30.35 }

const FIXTURE_VERTICES: LatLng[] = [
  { lon: 75.75, lat: 30.35 },
  { lon: 75.7514, lat: 30.35 }, // ~135m east at this latitude, trimmed below to ~100m via projection check isn't exact — fine for structural tests
  { lon: 75.7514, lat: 30.3504 },
  { lon: 75.75, lat: 30.3504 },
]

export function buildFixtureBoundary(): FieldBoundary {
  const boundary = createBoundary(FIXTURE_VERTICES, 'satellite-trace', { imageryDate: '2026-01-01' })
  // Mark edge 1 as walked (verified) and edge 2 as satellite-with-accepted-risk, so
  // exports that surface provenance have more than one kind to render.
  boundary.edges[1].provenance = { kind: 'walked', accuracyM: 1.2, verifiedAt: new Date().toISOString() }
  boundary.edges[2].provenance = { ...boundary.edges[2].provenance, acceptedRisk: true }
  return boundary
}

export const FIXTURE_ZONES: NoSprayZone[] = [
  {
    id: 'zone-1',
    label: 'Pond',
    vertices: [
      { lon: 75.7505, lat: 30.3501 },
      { lon: 75.7508, lat: 30.3501 },
      { lon: 75.7508, lat: 30.3503 },
      { lon: 75.7505, lat: 30.3503 },
    ],
  },
]

export const FIXTURE_DRONE_PROFILE: DroneProfile = DEFAULT_DRONE_PROFILE

export function buildFixtureScenario() {
  const boundary = buildFixtureBoundary()
  const projection = createLocalProjection(FIXTURE_ORIGIN)
  const boundaryLocal = projectAll(projection, boundary.vertices)
  const noSprayZonesLocal = FIXTURE_ZONES.map((z) => projectAll(projection, z.vertices))
  const sprayPlan: SprayPlan = planSprayPath({
    boundaryLocal,
    noSprayZonesLocal,
    droneProfile: FIXTURE_DRONE_PROFILE,
    sweepStrategy: { kind: 'min-turns' },
  })
  const readiness = computeReadiness(boundary, boundaryLocal)

  return { boundary, projection, sprayPlan, readiness, droneProfile: FIXTURE_DRONE_PROFILE, noSprayZones: FIXTURE_ZONES }
}
