/**
 * The printable field handoff sheet — a standalone, self-contained HTML
 * document (inline CSS, no external assets) meant for "closed ecosystem"
 * handoff: printed on paper, or opened on a laptop with no network, for
 * a ground crew or backup pilot who can't take a live Web-Serial link or
 * a digital file import. It repeats the same numbers as the app (area,
 * readiness, plan totals, drone profile) plus a full lat/lon waypoint
 * table a person could hand-key into another ground station if every
 * digital transfer path is unavailable.
 */
import { buildWaypointCsvRows } from './csv'
import type { LocalProjection } from '@/lib/geo/projection'
import type { DroneProfile, FieldBoundary, NoSprayZone, ProvenanceKind, ReadinessSummary, SprayPlan } from '@/lib/geo/types'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const PROVENANCE_LABEL: Record<ProvenanceKind, string> = {
  satellite: 'Satellite (unverified)',
  walked: 'GPS-walked',
  confirmed: 'Confirmed',
}

export interface HandoffSheetParams {
  fieldName: string
  boundary: FieldBoundary
  noSprayZones: NoSprayZone[]
  sprayPlan: SprayPlan
  droneProfile: DroneProfile
  readiness: ReadinessSummary | null
  projection: LocalProjection
  generatedAt?: Date
}

export function buildHandoffSheetHtml(params: HandoffSheetParams): string {
  const { fieldName, boundary, noSprayZones, sprayPlan, droneProfile, readiness, projection } = params
  const generatedAt = params.generatedAt ?? new Date()

  const provenanceCounts: Record<ProvenanceKind, number> = { satellite: 0, walked: 0, confirmed: 0 }
  let acceptedRiskCount = 0
  for (const edge of boundary.edges) {
    provenanceCounts[edge.provenance.kind]++
    if (edge.provenance.acceptedRisk) acceptedRiskCount++
  }

  const sortieRows = sprayPlan.sorties
    .map(
      (sortie) =>
        `<tr><td>${sortie.index + 1}</td><td>${sortie.passes.length}</td><td>${sortie.distanceM.toFixed(0)} m</td><td>${sortie.volumeL.toFixed(2)} L</td><td>${sortie.estimatedMinutes.toFixed(1)} min</td></tr>`,
    )
    .join('')

  const waypointRows = buildWaypointCsvRows(sprayPlan, projection, droneProfile.altitudeM)
    .map((r) => `<tr><td>${r.seq}</td><td>${r.sortie + 1}</td><td>${r.lat.toFixed(6)}</td><td>${r.lon.toFixed(6)}</td><td>${r.altM}</td><td>${r.spraying ? 'spray' : 'transit'}</td></tr>`)
    .join('')

  const zoneRows = noSprayZones
    .map((zone, i) => `<tr><td>${esc(zone.label || `Zone ${i + 1}`)}</td><td>${zone.vertices.length}</td></tr>`)
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${esc(fieldName)} — Field Handoff Sheet</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; color: #111827; margin: 0; padding: 24px; max-width: 800px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; margin: 20px 0 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .meta { color: #6b7280; font-size: 12px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #e5e7eb; }
  th { color: #6b7280; font-weight: 600; }
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 6px; }
  .stat { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; }
  .stat .label { font-size: 10px; color: #6b7280; text-transform: uppercase; }
  .stat .value { font-size: 16px; font-weight: 600; }
  .readiness { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .readiness.cleared { background: #dcfce7; color: #166534; }
  .readiness.blocked { background: #fee2e2; color: #991b1b; }
  .print-button { margin-top: 16px; padding: 8px 16px; font-size: 13px; border-radius: 6px; border: 1px solid #d1d5db; background: #f9fafb; cursor: pointer; }
  @media print {
    .no-print { display: none; }
    body { padding: 0; }
  }
</style>
</head>
<body>
  <button class="print-button no-print" onclick="window.print()">Print this sheet</button>
  <h1>${esc(fieldName)} — Field Handoff Sheet</h1>
  <div class="meta">Generated ${esc(generatedAt.toISOString())} · illustrative representative example, not a live vehicle link</div>

  <h2>Field summary</h2>
  <div class="stat-grid">
    <div class="stat"><div class="label">Area</div><div class="value">${sprayPlan.areaHa.toFixed(2)} ha</div></div>
    <div class="stat"><div class="label">Boundary vertices</div><div class="value">${boundary.vertices.length}</div></div>
    <div class="stat"><div class="label">No-spray zones</div><div class="value">${noSprayZones.length}</div></div>
    <div class="stat"><div class="label">Readiness</div><div class="value"><span class="readiness ${readiness?.cleared ? 'cleared' : 'blocked'}">${readiness?.cleared ? 'Cleared' : `${readiness?.unverifiedEdges ?? '?'} unverified`}</span></div></div>
  </div>
  <table>
    <thead><tr><th>Edge provenance</th><th>Count</th></tr></thead>
    <tbody>
      <tr><td>${PROVENANCE_LABEL.satellite}</td><td>${provenanceCounts.satellite}</td></tr>
      <tr><td>${PROVENANCE_LABEL.walked}</td><td>${provenanceCounts.walked}</td></tr>
      <tr><td>${PROVENANCE_LABEL.confirmed}</td><td>${provenanceCounts.confirmed}</td></tr>
      <tr><td>Accepted risk (unverified, pilot-cleared)</td><td>${acceptedRiskCount}</td></tr>
    </tbody>
  </table>

  <h2>No-spray zones</h2>
  ${noSprayZones.length === 0 ? '<p class="meta">None defined.</p>' : `<table><thead><tr><th>Label</th><th>Vertices</th></tr></thead><tbody>${zoneRows}</tbody></table>`}

  <h2>Drone profile — ${esc(droneProfile.name)}</h2>
  <table>
    <thead><tr><th>Swath</th><th>Speed</th><th>Tank</th><th>App. rate</th><th>Altitude</th><th>Endurance</th></tr></thead>
    <tbody><tr>
      <td>${droneProfile.swathM} m</td>
      <td>${droneProfile.speedMps} m/s</td>
      <td>${droneProfile.tankL} L</td>
      <td>${droneProfile.applicationRateLPerHa} L/ha</td>
      <td>${droneProfile.altitudeM} m AGL</td>
      <td>${droneProfile.enduranceMin} min</td>
    </tr></tbody>
  </table>

  <h2>Plan summary</h2>
  <div class="stat-grid">
    <div class="stat"><div class="label">Total distance</div><div class="value">${(sprayPlan.totalDistanceM / 1000).toFixed(2)} km</div></div>
    <div class="stat"><div class="label">Total volume</div><div class="value">${sprayPlan.totalVolumeL.toFixed(1)} L</div></div>
    <div class="stat"><div class="label">Est. time</div><div class="value">${sprayPlan.totalEstimatedMinutes.toFixed(0)} min</div></div>
    <div class="stat"><div class="label">Sorties</div><div class="value">${sprayPlan.sorties.length}</div></div>
  </div>
  <table>
    <thead><tr><th>Sortie</th><th>Passes</th><th>Distance</th><th>Volume</th><th>Est. time</th></tr></thead>
    <tbody>${sortieRows}</tbody>
  </table>

  <h2>Waypoints (${esc(String(boundary.id))}, ${droneProfile.altitudeM} m AGL)</h2>
  <table>
    <thead><tr><th>Seq</th><th>Sortie</th><th>Lat</th><th>Lon</th><th>Alt (m)</th><th>Leg</th></tr></thead>
    <tbody>${waypointRows}</tbody>
  </table>
</body>
</html>`
}
