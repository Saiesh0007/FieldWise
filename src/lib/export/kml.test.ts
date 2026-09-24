import { describe, expect, it } from 'vitest'
import { buildFieldKml } from './kml'
import { buildFixtureScenario } from './testFixtures'

/** Minimal structural XML sanity check without a DOM/XML parser dependency: every opening tag has a matching closing tag, in equal counts. Good enough to catch a broken template string (an unclosed tag, a stray literal) without pulling in a parser this project doesn't otherwise need. */
function countTag(xml: string, tag: string): { open: number; close: number } {
  const open = (xml.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length
  const close = (xml.match(new RegExp(`</${tag}>`, 'g')) ?? []).length
  return { open, close }
}

describe('buildFieldKml', () => {
  const scenario = buildFixtureScenario()

  it('starts with an XML declaration and a well-formed <kml> root', () => {
    const kml = buildFieldKml({ fieldName: 'Test Field', ...scenario, altitudeM: scenario.droneProfile.altitudeM })
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">')
    expect(kml.trim().endsWith('</kml>')).toBe(true)
  })

  it('has balanced open/close tags for every element it emits', () => {
    const kml = buildFieldKml({ fieldName: 'Test Field', ...scenario, altitudeM: scenario.droneProfile.altitudeM })
    for (const tag of ['kml', 'Document', 'Folder', 'Placemark', 'Polygon', 'LineString', 'Style', 'coordinates']) {
      const { open, close } = countTag(kml, tag)
      expect({ tag, open, close }).toEqual({ tag, open, close: open })
      expect(open).toBeGreaterThan(0)
    }
  })

  it("the boundary polygon's coordinate ring is closed (first vertex repeated last) and has one entry per boundary vertex plus closure", () => {
    const kml = buildFieldKml({ fieldName: 'Test Field', ...scenario, altitudeM: scenario.droneProfile.altitudeM })
    const boundaryBlockMatch = kml.match(/<Folder><name>Boundary<\/name>.*?<\/Folder>/s)
    expect(boundaryBlockMatch).not.toBeNull()
    const coordsMatch = boundaryBlockMatch![0].match(/<coordinates>(.*?)<\/coordinates>/)
    expect(coordsMatch).not.toBeNull()
    const coordTriples = coordsMatch![1].trim().split(' ')
    expect(coordTriples).toHaveLength(scenario.boundary.vertices.length + 1)

    const first = coordTriples[0].split(',').map(Number)
    const last = coordTriples[coordTriples.length - 1].split(',').map(Number)
    expect(first[0]).toBeCloseTo(last[0], 9)
    expect(first[1]).toBeCloseTo(last[1], 9)
    expect(first[0]).toBeCloseTo(scenario.boundary.vertices[0].lon, 9)
    expect(first[1]).toBeCloseTo(scenario.boundary.vertices[0].lat, 9)
  })

  it('emits one LineString Placemark per spray plan leg, split into spray/transit folders matching the plan', () => {
    const kml = buildFieldKml({ fieldName: 'Test Field', ...scenario, altitudeM: scenario.droneProfile.altitudeM })
    const sprayFolder = kml.match(/<Folder><name>Spray legs<\/name>(.*?)<\/Folder>/s)![1]
    const transitFolder = kml.match(/<Folder><name>Transit legs<\/name>(.*?)<\/Folder>/s)![1]

    const sprayLegCount = scenario.sprayPlan.sorties.reduce((sum, s) => sum + s.passes.filter((p) => p.spraying).length, 0)
    const transitLegCount = scenario.sprayPlan.sorties.reduce((sum, s) => sum + s.passes.filter((p) => !p.spraying).length, 0)

    expect(countTag(sprayFolder, 'Placemark').open).toBe(sprayLegCount)
    expect(countTag(transitFolder, 'Placemark').open).toBe(transitLegCount)
  })

  it('escapes special characters in the field name', () => {
    const kml = buildFieldKml({ fieldName: 'Tom & Jerry\'s "Field" <1>', ...scenario, altitudeM: 2 })
    expect(kml).toContain('Tom &amp; Jerry')
    expect(kml).not.toContain('<1>')
  })

  it('handles a plan-less export (no sprayPlan/projection) without emitting leg placemarks', () => {
    const kml = buildFieldKml({ fieldName: 'No Plan', boundary: scenario.boundary, noSprayZones: scenario.noSprayZones, sprayPlan: null, projection: null, altitudeM: 2 })
    expect(kml).toContain('<Folder><name>Spray legs</name></Folder>')
    expect(kml).toContain('<Folder><name>Transit legs</name></Folder>')
  })
})
