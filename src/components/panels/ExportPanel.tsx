import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { downloadTextFile, openHtmlInNewTab } from '@/lib/export/download'
import { buildWaypointCsv } from '@/lib/export/csv'
import { buildFieldGeoJson } from '@/lib/export/geojson'
import { buildHandoffSheetHtml } from '@/lib/export/handoffSheet'
import { buildFieldKml } from '@/lib/export/kml'
import { buildMissionPlannerWaypointsFile } from '@/lib/export/missionPlannerWaypoints'
import { buildQgcPlanJson } from '@/lib/export/qgcPlan'
import { useFieldStore } from '@/store/useFieldStore'

interface ExportFormat {
  key: string
  label: string
  extension: string
  description: string
  /** Honest about what was actually checked — see each builder's own header comment for the full reasoning. */
  verification: string
  run: () => void
}

export function ExportPanel() {
  const boundary = useFieldStore((s) => s.boundary)
  const noSprayZones = useFieldStore((s) => s.noSprayZones)
  const sprayPlan = useFieldStore((s) => s.sprayPlan)
  const projection = useFieldStore((s) => s.projection)
  const droneProfile = useFieldStore((s) => s.droneProfile)
  const readiness = useFieldStore((s) => s.readiness)

  const [fieldName, setFieldName] = useState('FieldWise Field')
  const [lastAction, setLastAction] = useState<string | null>(null)

  if (!boundary || !sprayPlan || !projection) {
    return <div className="p-4 text-sm text-(--text-secondary)">No plan yet — go back to Plan.</div>
  }

  const slug = fieldName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'field'

  const formats: ExportFormat[] = [
    {
      key: 'geojson',
      label: 'GeoJSON',
      extension: '.geojson',
      description: 'Boundary, no-spray zones, and spray/transit legs as one tagged FeatureCollection. Opens in QGIS, geojson.io, most web GIS.',
      verification: 'Unit-tested (round-trips through JSON.parse). Reuses the same feature builders the map itself renders from.',
      run: () => {
        const fc = buildFieldGeoJson(boundary, noSprayZones, sprayPlan, projection)
        downloadTextFile(`${slug}.geojson`, JSON.stringify(fc, null, 2), 'application/geo+json')
        setLastAction('Downloaded GeoJSON.')
      },
    },
    {
      key: 'kml',
      label: 'KML',
      extension: '.kml',
      description: 'Boundary + zones + spray plan for Google Earth, organized into folders (spray legs / transit legs, since KML has no dashed-line style).',
      verification: 'Structurally valid KML by inspection + unit tests. Not opened in an actual Google Earth in this environment — spot-check before a live demo.',
      run: () => {
        const kml = buildFieldKml({ fieldName, boundary, noSprayZones, sprayPlan, projection, altitudeM: droneProfile.altitudeM })
        downloadTextFile(`${slug}.kml`, kml, 'application/vnd.google-earth.kml+xml')
        setLastAction('Downloaded KML.')
      },
    },
    {
      key: 'qgc-plan',
      label: 'QGroundControl Plan',
      extension: '.plan',
      description: 'QGC native mission file — every leg as a NAV_WAYPOINT at flight altitude, same simplification as the live Web-Serial upload (no sprayer actuation command).',
      verification: 'Matches the documented QGC .plan schema by inspection + unit tests. Not opened in a real QGroundControl install here — spot-check an import before relying on it.',
      run: () => {
        const json = buildQgcPlanJson(sprayPlan, projection, droneProfile.altitudeM, droneProfile.speedMps)
        downloadTextFile(`${slug}.plan`, json, 'application/json')
        setLastAction('Downloaded QGC .plan.')
      },
    },
    {
      key: 'mission-planner',
      label: 'Mission Planner Waypoints',
      extension: '.waypoints',
      description: 'The plain-text "QGC WPL 110" format — accepted by both Mission Planner and QGroundControl’s legacy file-based waypoint editor.',
      verification: 'Well-documented text format; round-trip parsed by our own unit tests. Not opened in an actual Mission Planner install (Windows-only desktop app) in this environment.',
      run: () => {
        const text = buildMissionPlannerWaypointsFile(sprayPlan, projection, droneProfile.altitudeM)
        downloadTextFile(`${slug}.waypoints`, text, 'text/plain')
        setLastAction('Downloaded Mission Planner waypoints.')
      },
    },
    {
      key: 'csv',
      label: 'CSV',
      extension: '.csv',
      description: 'A plain waypoint table (seq, sortie, lat, lon, alt, spraying) — opens in Excel/Sheets or any text editor.',
      verification: 'Unit-tested (column counts, numeric parsing). The simplest format here to eyeball-verify yourself.',
      run: () => {
        const csv = buildWaypointCsv(sprayPlan, projection, droneProfile.altitudeM)
        downloadTextFile(`${slug}.csv`, csv, 'text/csv')
        setLastAction('Downloaded CSV.')
      },
    },
  ]

  const openHandoffSheet = () => {
    const html = buildHandoffSheetHtml({ fieldName, boundary, noSprayZones, sprayPlan, droneProfile, readiness, projection })
    openHtmlInNewTab(html)
    setLastAction('Opened the printable handoff sheet in a new tab.')
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-sm font-semibold text-(--text-primary)">Export &amp; handoff</h2>
        <p className="mt-1 text-xs text-(--text-secondary)">
          For closed ecosystems — no Web Serial link needed. Files download straight to your machine; each one below
          says what was actually verified against the real target tool versus checked only by inspection.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-(--text-secondary)">Field name (used in filenames &amp; the handoff sheet)</span>
        <input
          type="text"
          value={fieldName}
          onChange={(e) => setFieldName(e.target.value)}
          className="rounded-(--radius-control) border border-(--border-subtle) bg-(--surface-panel) px-2.5 py-1.5 text-sm text-(--text-primary) transition-colors focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </label>

      <div className="h-px bg-(--border-subtle)" />

      <div className="space-y-3">
        {formats.map((fmt) => (
          <div key={fmt.key} className="space-y-1.5 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-(--text-primary)">
                {fmt.label} <span className="text-(--text-muted)">{fmt.extension}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={fmt.run}>
                Download
              </Button>
            </div>
            <p className="text-xs text-(--text-secondary)">{fmt.description}</p>
            <p className="text-[11px] italic text-(--text-muted)">{fmt.verification}</p>
          </div>
        ))}
      </div>

      <div className="h-px bg-(--border-subtle)" />

      <div className="space-y-1.5 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-(--text-primary)">Printable handoff sheet</span>
          <Button size="sm" variant="primary" onClick={openHandoffSheet}>
            Open &amp; print
          </Button>
        </div>
        <p className="text-xs text-(--text-secondary)">
          A standalone page — field/plan/readiness summary plus the full lat/lon waypoint table — for a ground crew
          or backup pilot with no digital transfer path at all. Opens in a new tab with its own Print button.
        </p>
        <p className="text-[11px] italic text-(--text-muted)">
          Screenshot/inspection-verified layout; unit-tested for content correctness (totals, provenance counts,
          waypoint rows). Printing itself wasn't tested against a physical printer here.
        </p>
      </div>

      {lastAction && <p className="text-xs text-success">{lastAction}</p>}
    </div>
  )
}
