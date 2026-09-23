import { useCallback, useRef, useState } from 'react'
import type { DrawTarget } from '@/components/map/FieldMap'
import { DronePointCapture } from '@/components/panels/DronePointCapture'
import { GpsWalkCapture } from '@/components/panels/GpsWalkCapture'
import { LocationSearch, type SelectedLocation } from '@/components/panels/LocationSearch'
import { Button } from '@/components/ui/Button'
import { useDroneSimulation } from '@/hooks/useDroneSimulation'
import { createBoundary } from '@/lib/geo/boundary'
import { BoundaryImportError, parseBoundaryFile } from '@/lib/geo/importFormats'
import type { LatLng } from '@/lib/geo/types'
import { useFieldStore } from '@/store/useFieldStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlotMethod = 'rc-mobile' | 'drone' | 'map' | 'kml'

interface ImportPanelProps {
  drawTarget: DrawTarget
  onStartDrawBoundary: () => void
  onStartDrawZone: () => void
  onStartDrawCircleZone: () => void
  onCancelDraw: () => void
  onGpsWalkPointsChange: (points: LatLng[]) => void
  onLocationSelected: (location: SelectedLocation) => void

  // Drone capture integration
  droneCaptureActive: boolean
  dronePoints: LatLng[]
  onDronePointsChange: (points: LatLng[]) => void
  onStartDroneCapture: () => void
  onStopDroneCapture: () => void
  onDroneCaptureComplete: (vertices: LatLng[]) => void
}

// ---------------------------------------------------------------------------
// Method definitions
// ---------------------------------------------------------------------------

interface MethodDef {
  id: PlotMethod
  label: string
  icon: React.ReactNode
  description: string
}

const METHODS: MethodDef[] = [
  {
    id: 'rc-mobile',
    label: 'RC / Mobile',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
        <rect x="5" y="2" width="10" height="16" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="10" cy="14.5" r="1.2" fill="currentColor" />
        <path d="M7.5 6h5M7.5 8.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
    description: 'Walk the field perimeter with your phone or RC controller GPS.',
  },
  {
    id: 'drone',
    label: 'Drone',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
        <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M3.5 3.5h3v3M13.5 3.5h3v3M3.5 16.5h3v-3M13.5 16.5h3v-3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6 6L8.2 8.2M11.8 8.2L14 6M8.2 11.8L6 14M11.8 11.8L14 14"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    ),
    description: 'Fly your drone to each corner and click the map at its position to mark it.',
  },
  {
    id: 'map',
    label: 'Map',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
        <path
          d="M2 5l6-2 4 2 6-2v12l-6 2-4-2-6 2V5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M8 3v12M12 5v12" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.5" />
      </svg>
    ),
    description: 'Trace the boundary by clicking directly on the satellite map.',
  },
  {
    id: 'kml',
    label: 'Import KML',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
        <path
          d="M11 2H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-5-5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M11 2v5h5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M7 12l2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    description: 'Import a .kml or .geojson file exported from any GIS tool.',
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImportPanel({
  drawTarget,
  onStartDrawBoundary,
  onStartDrawZone,
  onStartDrawCircleZone,
  onCancelDraw,
  onGpsWalkPointsChange,
  onLocationSelected,
  droneCaptureActive,
  dronePoints,
  onDronePointsChange,
  onStartDroneCapture,
  onStopDroneCapture,
  onDroneCaptureComplete,
}: ImportPanelProps) {
  const boundary = useFieldStore((s) => s.boundary)
  const noSprayZones = useFieldStore((s) => s.noSprayZones)
  const sprayPlan = useFieldStore((s) => s.sprayPlan)
  const readiness = useFieldStore((s) => s.readiness)
  const setBoundary = useFieldStore((s) => s.setBoundary)
  const removeNoSprayZone = useFieldStore((s) => s.removeNoSprayZone)
  const loadSample = useFieldStore((s) => s.loadSample)
  const setStep = useFieldStore((s) => s.setStep)

  const [activeMethod, setActiveMethod] = useState<PlotMethod>('rc-mobile')
  const [gpsWalkOpen, setGpsWalkOpen] = useState(false)
  const [droneSimulating, setDroneSimulating] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [obstaclePickerOpen, setObstaclePickerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Drone simulation via useDroneSimulation hook
  const handleSimDone = useCallback(() => {
    setDroneSimulating(false)
  }, [])

  useDroneSimulation(droneSimulating, onDronePointsChange, handleSimDone)


  const handleMethodSelect = (method: PlotMethod) => {
    // Cancel any in-progress modes when switching
    if (gpsWalkOpen) {
      setGpsWalkOpen(false)
      onGpsWalkPointsChange([])
    }
    if (droneCaptureActive) {
      setDroneSimulating(false)
      onStopDroneCapture()
    }
    if (drawTarget) {
      onCancelDraw()
    }
    setFileError(null)
    setActiveMethod(method)
  }

  const handleFile = (file: File) => {
    setFileError(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result)
        const vertices = parseBoundaryFile(file.name, text)
        const source = file.name.toLowerCase().endsWith('.kml') ? 'kml-import' : 'geojson-import'
        setBoundary(createBoundary(vertices, source))
      } catch (err) {
        setFileError(err instanceof BoundaryImportError ? err.message : 'Could not read this file.')
      }
    }
    reader.onerror = () => setFileError('Could not read this file.')
    reader.readAsText(file)
  }

  // ------ Drone capture forwarding ------
  const handleStartDrone = () => {
    onStartDroneCapture()
  }

  const handleStopDroneCapture = () => {
    setDroneSimulating(false)
    onStopDroneCapture()
  }

  const handleStartDroneSim = () => {
    if (!droneCaptureActive) onStartDroneCapture()
    onDronePointsChange([])
    setDroneSimulating(true)
  }

  const handleStopDroneSim = () => {
    setDroneSimulating(false)
  }


  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-(--text-primary)">Create field plot</h2>
        <p className="mt-1 text-xs text-(--text-secondary)">
          Choose how to mark boundary points for your field. Every method produces a
          verified-or-unverified prior — nothing is trusted until confirmed in Verify.
        </p>
      </div>

      <LocationSearch onLocationSelected={onLocationSelected} />

      <div className="h-px bg-(--border-subtle)" />

      {/* Quick-load sample */}
      <Button variant="primary" onClick={loadSample}>
        Load sample field
      </Button>

      <div className="h-px bg-(--border-subtle)" />

      {/* ---- Method selector tabs ---- */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
          Plot creation method
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {METHODS.map((m) => {
            const isActive = activeMethod === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleMethodSelect(m.id)}
                className={[
                  'flex flex-col items-center gap-1 rounded-(--radius-control) border px-2 py-2.5 text-xs font-medium transition-all duration-150',
                  isActive
                    ? 'border-brand-400/60 bg-brand-50 text-brand-700 shadow-sm'
                    : 'border-(--border-subtle) bg-(--surface-panel) text-(--text-secondary) hover:bg-(--surface-panel-raised) hover:text-(--text-primary)',
                ].join(' ')}
                aria-pressed={isActive}
              >
                <span className={isActive ? 'text-brand-600' : 'text-(--text-muted)'}>{m.icon}</span>
                <span>{m.label}</span>
              </button>
            )
          })}
        </div>

        {/* Method description */}
        <p className="mt-2 text-xs text-(--text-muted)">
          {METHODS.find((m) => m.id === activeMethod)?.description}
        </p>
      </div>

      {/* ---- Method-specific UI ---- */}

      {/* 9.1  RC / Mobile  —  GPS walk */}
      {activeMethod === 'rc-mobile' && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
            GPS walk
          </h3>
          {gpsWalkOpen ? (
            <GpsWalkCapture
              onComplete={(vertices) => {
                setBoundary(createBoundary(vertices, 'gps-walk'))
                setGpsWalkOpen(false)
                onGpsWalkPointsChange([])
              }}
              onCancel={() => {
                setGpsWalkOpen(false)
                onGpsWalkPointsChange([])
              }}
              onPointsChange={onGpsWalkPointsChange}
            />
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={drawTarget !== null || droneCaptureActive}
              onClick={() => setGpsWalkOpen(true)}
            >
              Walk the boundary
            </Button>
          )}
        </section>
      )}

      {/* 9.2  Drone  —  point-by-point at drone position */}
      {activeMethod === 'drone' && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
            Drone point capture
          </h3>
          {droneCaptureActive ? (
            <DronePointCapture
              points={dronePoints}
              onPointsChange={onDronePointsChange}
              onComplete={onDroneCaptureComplete}
              onCancel={handleStopDroneCapture}
              isSimulating={droneSimulating}
              onStartSimulate={handleStartDroneSim}
              onStopSimulate={handleStopDroneSim}
            />
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={drawTarget !== null || gpsWalkOpen}
              onClick={handleStartDrone}
            >
              Start drone capture
            </Button>
          )}
        </section>
      )}

      {/* 9.3  Map  —  draw on satellite */}
      {activeMethod === 'map' && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
            Trace on satellite map
          </h3>
          {drawTarget === 'boundary' ? (
            <Button size="sm" variant="secondary" onClick={onCancelDraw}>
              Cancel drawing
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={drawTarget !== null || droneCaptureActive || gpsWalkOpen}
              onClick={onStartDrawBoundary}
            >
              Draw boundary on map
            </Button>
          )}
        </section>
      )}

      {/* 9.4  Import KML  —  file upload */}
      {activeMethod === 'kml' && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
            Import file
          </h3>
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json,.kml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
              e.target.value = ''
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            Browse .kml / .geojson file
          </Button>
          {fileError && <p className="text-xs text-danger">{fileError}</p>}
          <p className="text-xs text-(--text-muted)">
            Supports KML files from any GIS tool (DJI, QGIS, Google Earth, etc.) and GeoJSON.
          </p>
        </section>
      )}

      {/* ---- Current field / zones / continue ---- */}
      {boundary && (
        <>
          <div className="h-px bg-(--border-subtle)" />

          <section className="space-y-2 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Current field</h3>
              <span className="text-xs text-(--text-muted)">{boundary.vertices.length} vertices</span>
            </div>
            <div className="text-sm text-(--text-primary)">{sprayPlan ? `${sprayPlan.areaHa.toFixed(2)} ha sprayable` : '—'}</div>
            {readiness && (
              <div className="text-xs text-(--text-secondary)">
                {readiness.cleared ? 'All edges verified' : `${readiness.unverifiedEdges} of ${readiness.totalEdges} edges unverified`}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">No-spray zones / obstacles</h3>
              {drawTarget === 'zone' || drawTarget === 'circle-zone' ? (
                <Button size="sm" variant="ghost" onClick={onCancelDraw}>
                  Cancel
                </Button>
              ) : obstaclePickerOpen ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setObstaclePickerOpen(false)
                      onStartDrawZone()
                    }}
                  >
                    Polygon
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setObstaclePickerOpen(false)
                      onStartDrawCircleZone()
                    }}
                  >
                    Circle
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setObstaclePickerOpen(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={drawTarget !== null || droneCaptureActive}
                  onClick={() => setObstaclePickerOpen(true)}
                >
                  + Add obstacle
                </Button>
              )}
            </div>
            {obstaclePickerOpen && (
              <p className="text-xs text-(--text-muted)">
                Polygon: draw freehand on the map. Circle: click a center, then click again to set the radius.
              </p>
            )}
            {noSprayZones.length === 0 ? (
              <p className="text-xs text-(--text-muted)">None yet — obstacles, ponds, or exclusion lanes.</p>
            ) : (
              <ul className="space-y-1">
                {noSprayZones.map((zone) => (
                  <li
                    key={zone.id}
                    className="flex items-center justify-between rounded-(--radius-control) border border-(--border-subtle) px-2.5 py-1.5 text-sm"
                  >
                    <span>
                      {zone.label}
                      {zone.shape === 'circle' && zone.radiusM != null && (
                        <span className="text-(--text-muted)"> · circle, r={zone.radiusM.toFixed(0)}m</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-danger hover:underline"
                      onClick={() => removeNoSprayZone(zone.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-auto pt-2">
            <Button variant="primary" className="w-full" onClick={() => setStep('verify')}>
              Continue to Verify
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
