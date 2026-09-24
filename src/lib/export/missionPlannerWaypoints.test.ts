import { describe, expect, it } from 'vitest'
import { buildMissionPlannerWaypointRows, buildMissionPlannerWaypointsFile, parseMissionPlannerWaypointsFile } from './missionPlannerWaypoints'
import { buildFixtureScenario } from './testFixtures'

describe('buildMissionPlannerWaypointsFile', () => {
  const scenario = buildFixtureScenario()

  it('starts with the exact "QGC WPL 110" header line', () => {
    const text = buildMissionPlannerWaypointsFile(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM)
    expect(text.split('\n')[0]).toBe('QGC WPL 110')
  })

  it('row 0 is the home position: current=1, frame=0 (global absolute)', () => {
    const rows = buildMissionPlannerWaypointRows(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM)
    expect(rows[0].index).toBe(0)
    expect(rows[0].current).toBe(1)
    expect(rows[0].frame).toBe(0)
    expect(rows[0].command).toBe(16)
  })

  it('every subsequent row is a NAV_WAYPOINT on frame 3 (global relative alt), current=0, autocontinue=1', () => {
    const rows = buildMissionPlannerWaypointRows(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM)
    expect(rows.length).toBeGreaterThan(1)
    for (const r of rows.slice(1)) {
      expect(r.frame).toBe(3)
      expect(r.command).toBe(16)
      expect(r.current).toBe(0)
      expect(r.autoContinue).toBe(1)
    }
  })

  it('indices are sequential starting at 0', () => {
    const rows = buildMissionPlannerWaypointRows(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM)
    rows.forEach((r, i) => expect(r.index).toBe(i))
  })

  it('round-trips through the file writer and its own parser with every field intact', () => {
    const rows = buildMissionPlannerWaypointRows(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM)
    const text = buildMissionPlannerWaypointsFile(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM)
    const parsed = parseMissionPlannerWaypointsFile(text)

    expect(parsed.header).toBe('QGC WPL 110')
    expect(parsed.rows).toHaveLength(rows.length)
    parsed.rows.forEach((r, i) => {
      expect(r.index).toBe(rows[i].index)
      expect(r.frame).toBe(rows[i].frame)
      expect(r.command).toBe(rows[i].command)
      expect(r.lat).toBeCloseTo(rows[i].lat, 9)
      expect(r.lon).toBeCloseTo(rows[i].lon, 9)
      expect(r.alt).toBeCloseTo(rows[i].alt, 9)
    })
  })

  it('every row has exactly 12 tab-separated fields', () => {
    const text = buildMissionPlannerWaypointsFile(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM)
    const lines = text.trim().split('\n').slice(1)
    for (const line of lines) {
      expect(line.split('\t')).toHaveLength(12)
    }
  })

  it('throws for a plan with no waypoints', () => {
    const emptyPlan = { sorties: [], totalDistanceM: 0, totalVolumeL: 0, totalEstimatedMinutes: 0, areaHa: 0, headingDeg: 0 }
    expect(() => buildMissionPlannerWaypointRows(emptyPlan, scenario.projection, 2)).toThrow()
  })

  it('parser rejects a malformed row', () => {
    expect(() => parseMissionPlannerWaypointsFile('QGC WPL 110\n0\t1\t0\t16\tnot-enough-fields')).toThrow()
  })
})
