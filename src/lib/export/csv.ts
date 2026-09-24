/**
 * CSV export — the simplest, most universally-openable format here
 * (Excel, Sheets, any text editor). One row per waypoint, in flight
 * order, with the same flattened point list the other vehicle-facing
 * exports use.
 */
import { flattenPlanToLatLngPoints } from './flattenPlan'
import type { LocalProjection } from '@/lib/geo/projection'
import type { SprayPlan } from '@/lib/geo/types'

export interface CsvWaypointRow {
  seq: number
  sortie: number
  lat: number
  lon: number
  altM: number
  spraying: boolean
}

const CSV_HEADER = ['seq', 'sortie', 'lat', 'lon', 'alt_m', 'spraying']

export function buildWaypointCsvRows(plan: SprayPlan, projection: LocalProjection, altitudeM: number): CsvWaypointRow[] {
  const points = flattenPlanToLatLngPoints(plan, projection)

  // Re-walk sortie/spraying membership in lockstep with the same
  // flattening order flattenPlanToLatLngPoints uses, so each output
  // point gets the right sortie index and spray/transit flag.
  const rows: CsvWaypointRow[] = []
  let seq = 0
  let pointIndex = 0
  let lastLocal: { x: number; y: number } | null = null
  for (const sortie of plan.sorties) {
    for (const pass of sortie.passes) {
      if (!lastLocal || lastLocal.x !== pass.start.x || lastLocal.y !== pass.start.y) {
        const p = points[pointIndex++]
        rows.push({ seq: seq++, sortie: sortie.index, lat: p.lat, lon: p.lon, altM: altitudeM, spraying: pass.spraying })
      }
      const p = points[pointIndex++]
      rows.push({ seq: seq++, sortie: sortie.index, lat: p.lat, lon: p.lon, altM: altitudeM, spraying: pass.spraying })
      lastLocal = pass.end
    }
  }

  return rows
}

export function buildWaypointCsv(plan: SprayPlan, projection: LocalProjection, altitudeM: number): string {
  const rows = buildWaypointCsvRows(plan, projection, altitudeM)
  const lines = rows.map((r) => [r.seq, r.sortie, r.lat, r.lon, r.altM, r.spraying].join(','))
  return [CSV_HEADER.join(','), ...lines].join('\n') + '\n'
}
