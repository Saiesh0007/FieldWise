/**
 * Mission Planner / QGC-legacy `.waypoints` export — the plain-text
 * "QGC WPL 110" tab-delimited waypoint file format (the de facto
 * ArduPilot standard, documented at ardupilot.org's "Common Waypoint
 * File Format" page). Both Mission Planner and QGroundControl's legacy
 * file-based waypoint editor accept this format, which is why it's the
 * most widely-compatible export for closed/offline ground stations here.
 *
 * Row 0 is the home position (current=1, frame=0 absolute). Every
 * following row is a MAV_CMD_NAV_WAYPOINT (16) on
 * MAV_FRAME_GLOBAL_RELATIVE_ALT (3), matching the QGC `.plan` export.
 *
 * Verification status: the text format itself is well-documented and
 * simple enough to be confident about by inspection; this file's own
 * unit tests round-trip-parse the generated text back into records and
 * check every field. It has not been opened in an actual Mission
 * Planner install (Windows-only desktop app, not available in this
 * sandboxed dev environment) — spot-check an import there before a live
 * demo if Mission Planner itself matters for the handoff.
 */
import { flattenPlanToLatLngPoints } from './flattenPlan'
import type { LocalProjection } from '@/lib/geo/projection'
import type { SprayPlan } from '@/lib/geo/types'

const MAV_CMD_NAV_WAYPOINT = 16
const MAV_FRAME_GLOBAL_ABSOLUTE = 0
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3

export interface WaypointFileRow {
  index: number
  current: 0 | 1
  frame: number
  command: number
  param1: number
  param2: number
  param3: number
  param4: number
  lat: number
  lon: number
  alt: number
  autoContinue: 0 | 1
}

function row(fields: WaypointFileRow): string {
  return [
    fields.index,
    fields.current,
    fields.frame,
    fields.command,
    fields.param1,
    fields.param2,
    fields.param3,
    fields.param4,
    fields.lat,
    fields.lon,
    fields.alt,
    fields.autoContinue,
  ].join('\t')
}

export function buildMissionPlannerWaypointRows(plan: SprayPlan, projection: LocalProjection, altitudeM: number): WaypointFileRow[] {
  const points = flattenPlanToLatLngPoints(plan, projection)
  if (points.length === 0) {
    throw new Error('buildMissionPlannerWaypointRows: spray plan has no waypoints to export.')
  }

  const home = points[0]
  const rows: WaypointFileRow[] = [
    {
      index: 0,
      current: 1,
      frame: MAV_FRAME_GLOBAL_ABSOLUTE,
      command: MAV_CMD_NAV_WAYPOINT,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      lat: home.lat,
      lon: home.lon,
      alt: altitudeM,
      autoContinue: 1,
    },
  ]

  points.forEach((p, i) => {
    rows.push({
      index: i + 1,
      current: 0,
      frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
      command: MAV_CMD_NAV_WAYPOINT,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      lat: p.lat,
      lon: p.lon,
      alt: altitudeM,
      autoContinue: 1,
    })
  })

  return rows
}

export function buildMissionPlannerWaypointsFile(plan: SprayPlan, projection: LocalProjection, altitudeM: number): string {
  const rows = buildMissionPlannerWaypointRows(plan, projection, altitudeM)
  return ['QGC WPL 110', ...rows.map(row)].join('\n') + '\n'
}

/** Parses a "QGC WPL 110" file back into rows — used by this module's own tests to round-trip-verify the writer, and reusable if the app ever needs to import this format. */
export function parseMissionPlannerWaypointsFile(text: string): { header: string; rows: WaypointFileRow[] } {
  const lines = text.trim().split('\n').map((l) => l.trimEnd())
  const [header, ...rest] = lines
  const rows = rest
    .filter((l) => l.length > 0)
    .map((line) => {
      const cols = line.split('\t').map(Number)
      if (cols.length !== 12 || cols.some(Number.isNaN)) {
        throw new Error(`parseMissionPlannerWaypointsFile: malformed row "${line}"`)
      }
      const [index, current, frame, command, param1, param2, param3, param4, lat, lon, alt, autoContinue] = cols
      return { index, current: current as 0 | 1, frame, command, param1, param2, param3, param4, lat, lon, alt, autoContinue: autoContinue as 0 | 1 }
    })
  return { header, rows }
}
