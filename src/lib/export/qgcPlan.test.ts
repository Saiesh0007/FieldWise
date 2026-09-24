import { describe, expect, it } from 'vitest'
import { buildQgcPlan, buildQgcPlanJson } from './qgcPlan'
import { buildFixtureScenario } from './testFixtures'

describe('buildQgcPlan', () => {
  const scenario = buildFixtureScenario()

  it('produces the top-level QGC .plan schema shape', () => {
    const plan = buildQgcPlan(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM, scenario.droneProfile.speedMps)
    expect(plan.fileType).toBe('Plan')
    expect(plan.groundStation).toBe('QGroundControl')
    expect(plan.version).toBe(1)
    expect(plan.mission.version).toBe(2)
    expect(Array.isArray(plan.mission.items)).toBe(true)
    expect(plan.geoFence).toEqual({ circles: [], polygons: [], version: 2 })
    expect(plan.rallyPoints).toEqual({ points: [], version: 2 })
  })

  it('emits one MAV_CMD_NAV_WAYPOINT SimpleItem per flattened waypoint, with sequential doJumpId starting at 1', () => {
    const plan = buildQgcPlan(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM, scenario.droneProfile.speedMps)
    expect(plan.mission.items.length).toBeGreaterThan(0)
    plan.mission.items.forEach((item, i) => {
      expect(item.type).toBe('SimpleItem')
      expect(item.command).toBe(16)
      expect(item.frame).toBe(3)
      expect(item.doJumpId).toBe(i + 1)
      expect(item.autoContinue).toBe(true)
      // params = [hold, acceptRadius, passRadius, yaw, lat, lon, alt]
      expect(item.params).toHaveLength(7)
      const [, , , , lat, lon, alt] = item.params
      expect(lat).toBeGreaterThan(-90)
      expect(lat).toBeLessThan(90)
      expect(lon).toBeGreaterThan(-180)
      expect(lon).toBeLessThan(180)
      expect(alt).toBe(scenario.droneProfile.altitudeM)
    })
  })

  it("sets plannedHomePosition to the first waypoint's position", () => {
    const plan = buildQgcPlan(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM, scenario.droneProfile.speedMps)
    const [firstLat, , firstLon] = [plan.mission.items[0].params[4], undefined, plan.mission.items[0].params[5]]
    expect(plan.mission.plannedHomePosition[0]).toBeCloseTo(firstLat as number, 9)
    expect(plan.mission.plannedHomePosition[1]).toBeCloseTo(firstLon as number, 9)
    expect(plan.mission.plannedHomePosition[2]).toBe(scenario.droneProfile.altitudeM)
  })

  it('throws for a plan with no waypoints (degenerate empty plan)', () => {
    const emptyPlan = { sorties: [], totalDistanceM: 0, totalVolumeL: 0, totalEstimatedMinutes: 0, areaHa: 0, headingDeg: 0 }
    expect(() => buildQgcPlan(emptyPlan, scenario.projection, 2, 5)).toThrow()
  })

  it('buildQgcPlanJson produces valid, parseable JSON matching buildQgcPlan', () => {
    const json = buildQgcPlanJson(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM, scenario.droneProfile.speedMps)
    const parsed = JSON.parse(json)
    expect(parsed).toEqual(buildQgcPlan(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM, scenario.droneProfile.speedMps))
  })
})
