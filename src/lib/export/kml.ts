/**
 * KML export, for Google Earth and other KML-consuming tools.
 *
 * Known limitation: KML has no line-dash style that Google Earth (or
 * most other KML viewers) actually renders, so this can't reuse the
 * map's solid-spray/dashed-transit convention directly. Spray and
 * transit legs are instead split into separate folders and colors
 * (green vs. gray) — documented here so that difference doesn't read as
 * a regression from the map UI, just a format limitation.
 *
 * Verification status: structurally valid KML/XML by inspection and by
 * this file's own unit tests (well-formed tags, coordinate counts,
 * round-trip-parseable numbers) — it has not been opened in an actual
 * copy of Google Earth in this sandboxed dev environment, which has no
 * GUI applications available to do that check. Spot-check it in Google
 * Earth (or Earth Web) before relying on it for a live demo.
 */
import { cssHexToKmlColor } from './kmlColor'
import { PROVENANCE_COLORS } from '@/lib/map/provenanceColors'
import type { LocalProjection } from '@/lib/geo/projection'
import type { FieldBoundary, LatLng, NoSprayZone, SprayPlan } from '@/lib/geo/types'

const NO_SPRAY_RED = '#dc2626'
const TRANSIT_GRAY = '#9ca3af'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function ringCoordsKml(vertices: LatLng[], altM = 0): string {
  const closed = [...vertices, vertices[0]]
  return closed.map((v) => `${v.lon},${v.lat},${altM}`).join(' ')
}

function polygonPlacemark(name: string, vertices: LatLng[], styleUrl: string): string {
  return `<Placemark><name>${esc(name)}</name><styleUrl>${styleUrl}</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${ringCoordsKml(vertices)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
}

function lineStringPlacemark(name: string, a: LatLng, b: LatLng, altM: number, styleUrl: string): string {
  return `<Placemark><name>${esc(name)}</name><styleUrl>${styleUrl}</styleUrl><LineString><altitudeMode>relativeToGround</altitudeMode><coordinates>${a.lon},${a.lat},${altM} ${b.lon},${b.lat},${altM}</coordinates></LineString></Placemark>`
}

export interface BuildKmlParams {
  fieldName: string
  boundary: FieldBoundary
  noSprayZones: NoSprayZone[]
  sprayPlan: SprayPlan | null
  projection: LocalProjection | null
  altitudeM: number
}

export function buildFieldKml(params: BuildKmlParams): string {
  const { fieldName, boundary, noSprayZones, sprayPlan, projection, altitudeM } = params

  const zonesKml = noSprayZones
    .map((zone, i) => polygonPlacemark(zone.label || `No-spray zone ${i + 1}`, zone.vertices, '#noSprayStyle'))
    .join('')

  let sprayLegsKml = ''
  let transitLegsKml = ''
  if (sprayPlan && projection) {
    let legIndex = 0
    for (const sortie of sprayPlan.sorties) {
      for (const pass of sortie.passes) {
        legIndex += 1
        const a = projection.toLatLng(pass.start)
        const b = projection.toLatLng(pass.end)
        const name = `Sortie ${sortie.index + 1} — leg ${legIndex}`
        if (pass.spraying) sprayLegsKml += lineStringPlacemark(name, a, b, altitudeM, '#sprayLegStyle')
        else transitLegsKml += lineStringPlacemark(name, a, b, altitudeM, '#transitLegStyle')
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${esc(fieldName)}</name>
<Style id="boundaryStyle"><LineStyle><color>${cssHexToKmlColor(PROVENANCE_COLORS.walked)}</color><width>3</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>
<Style id="noSprayStyle"><LineStyle><color>${cssHexToKmlColor(NO_SPRAY_RED)}</color><width>2</width></LineStyle><PolyStyle><color>55${cssHexToKmlColor(NO_SPRAY_RED).slice(2)}</color></PolyStyle></Style>
<Style id="sprayLegStyle"><LineStyle><color>${cssHexToKmlColor(PROVENANCE_COLORS.confirmed)}</color><width>3</width></LineStyle></Style>
<Style id="transitLegStyle"><LineStyle><color>${cssHexToKmlColor(TRANSIT_GRAY)}</color><width>1</width></LineStyle></Style>
<Folder><name>Boundary</name>${polygonPlacemark(fieldName, boundary.vertices, '#boundaryStyle')}</Folder>
<Folder><name>No-Spray Zones</name>${zonesKml}</Folder>
<Folder><name>Spray Plan</name><Folder><name>Spray legs</name>${sprayLegsKml}</Folder><Folder><name>Transit legs</name>${transitLegsKml}</Folder></Folder>
</Document>
</kml>`
}
