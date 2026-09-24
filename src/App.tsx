import { useCallback, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { FieldMap, type CorrectionTarget, type DrawTarget, type FlyToRequest, type SimulateOverlay } from '@/components/map/FieldMap'
import { ExportPanel } from '@/components/panels/ExportPanel'
import { ImportPanel } from '@/components/panels/ImportPanel'
import type { SelectedLocation } from '@/components/panels/LocationSearch'
import { PlanPanel } from '@/components/panels/PlanPanel'
import { ProjectsPanel } from '@/components/panels/ProjectsPanel'
import { SendPanel } from '@/components/panels/SendPanel'
import { SimulatePanel } from '@/components/panels/SimulatePanel'
import { VerifyPanel } from '@/components/panels/VerifyPanel'
import { useProjectAutosave } from '@/hooks/useProjectAutosave'
import { createBoundary } from '@/lib/geo/boundary'
import { circleToPolygon } from '@/lib/geo/circleObstacle'
import { headingDegBetween } from '@/lib/geo/projection'
import type { LatLng } from '@/lib/geo/types'
import { useFieldStore } from '@/store/useFieldStore'

function App() {
  useProjectAutosave()

  const currentStep = useFieldStore((s) => s.currentStep)
  const boundary = useFieldStore((s) => s.boundary)
  const noSprayZones = useFieldStore((s) => s.noSprayZones)
  const sprayPlan = useFieldStore((s) => s.sprayPlan)
  const planSplitPercent = useFieldStore((s) => s.planSplitPercent)
  const planSplitDirection = useFieldStore((s) => s.planSplitDirection)
  const projection = useFieldStore((s) => s.projection)
  const selectedEdgeId = useFieldStore((s) => s.selectedEdgeId)
  const setSelectedEdgeId = useFieldStore((s) => s.setSelectedEdgeId)
  const setBoundary = useFieldStore((s) => s.setBoundary)
  const addNoSprayZone = useFieldStore((s) => s.addNoSprayZone)
  const updateNoSprayZone = useFieldStore((s) => s.updateNoSprayZone)
  const walkEdge = useFieldStore((s) => s.walkEdge)
  const setSweepStrategy = useFieldStore((s) => s.setSweepStrategy)

  // Transient interaction UI state — shared between a sidebar panel
  // (which triggers/labels it) and FieldMap (which renders it). Lives
  // here rather than in the store since it's pure UI state, not session
  // data: drawing, GPS-walk capture, edge corrections, crop-row tapping.
  const [drawTarget, setDrawTarget] = useState<DrawTarget>(null)
  const [liveWalkPath, setLiveWalkPath] = useState<LatLng[]>([])
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null)
  const [cropRowTapActive, setCropRowTapActive] = useState(false)
  const [simulateOverlay, setSimulateOverlay] = useState<SimulateOverlay | null>(null)
  const [dronePreviewPosition, setDronePreviewPosition] = useState<{ lat: number; lon: number; headingDeg: number } | null>(null)
  const [flyTo, setFlyTo] = useState<FlyToRequest | null>(null)
  const [projectsOpen, setProjectsOpen] = useState(false)

  // Drone point-capture state — active while the user is in "Drone" plot-creation mode.
  const [droneCaptureActive, setDroneCaptureActive] = useState(false)
  const [dronePoints, setDronePoints] = useState<LatLng[]>([])

  // Edit Obstacle (AeroGCS Green §12.3) — which no-spray zone is being
  // edited, and which of its vertices (if any) is selected for deletion.
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [editingVertexIndex, setEditingVertexIndex] = useState<number | null>(null)

  // A fresh object every time (even for an identical place searched
  // twice), so FieldMap's effect — keyed on this whole object's
  // identity — re-triggers the camera move each time, not just the
  // first.
  const handleLocationSelected = (location: SelectedLocation) => {
    setFlyTo({ lat: location.lat, lon: location.lon, boundingBox: location.boundingBox })
  }

  const handleCenterOnDrone = (position: LatLng) => {
    setFlyTo({ lat: position.lat, lon: position.lon, boundingBox: null })
  }

  const handleDrawFinish = (vertices: LatLng[]) => {
    if (drawTarget === 'boundary') {
      setBoundary(createBoundary(vertices, 'satellite-trace', { imageryDate: new Date().toISOString().slice(0, 10) }))
    } else if (drawTarget === 'zone') {
      addNoSprayZone({ id: `zone-${Date.now()}`, label: `Zone ${noSprayZones.length + 1}`, vertices, shape: 'polygon' })
    }
    setDrawTarget(null)
  }

  const handleCircleZoneFinish = (center: LatLng, radiusM: number) => {
    addNoSprayZone({
      id: `zone-${Date.now()}`,
      label: `Obstacle ${noSprayZones.length + 1}`,
      vertices: circleToPolygon(center, radiusM),
      shape: 'circle',
      center,
      radiusM,
    })
    setDrawTarget(null)
  }

  const handleStartEditZone = (id: string) => {
    setEditingZoneId(id)
    setEditingVertexIndex(null)
    setDrawTarget(null) // can't draw a new obstacle while editing an existing one
  }

  const handleZoneEditDone = () => {
    setEditingZoneId(null)
    setEditingVertexIndex(null)
  }

  const handleZoneEdit = (id: string, update: { vertices: LatLng[]; radiusM?: number }) => {
    updateNoSprayZone(id, update)
  }

  const handleDeleteEditVertex = () => {
    if (!editingZoneId || editingVertexIndex === null) return
    const zone = noSprayZones.find((z) => z.id === editingZoneId)
    if (!zone || zone.shape === 'circle' || zone.vertices.length <= 3) return
    updateNoSprayZone(editingZoneId, { vertices: zone.vertices.filter((_, i) => i !== editingVertexIndex) })
    setEditingVertexIndex(null)
  }

  const handleCorrectionFinish = (trace: LatLng[], accuracyM: number) => {
    if (!correctionTarget) return
    try {
      walkEdge(correctionTarget.edgeId, trace, accuracyM)
    } catch (err) {
      // A self-crossing (or otherwise invalid) trace is rejected rather
      // than silently applied — keep the correction session open so the
      // pilot can see why and walk it again, instead of losing their
      // in-progress edge selection on a failed merge.
      window.alert(err instanceof Error ? err.message : 'Could not apply that correction.')
      return
    }
    setCorrectionTarget(null)
  }

  const handleCropRowTap = (a: LatLng, b: LatLng) => {
    if (projection) {
      setSweepStrategy({ kind: 'crop-row', headingDeg: headingDegBetween(projection, a, b) })
    }
    setCropRowTapActive(false)
  }

  // Drone capture handlers
  // Two independent, self-contained functional updates rather than
  // calling setLiveWalkPath from inside setDronePoints's updater — an
  // updater function must stay pure (React StrictMode double-invokes it
  // specifically to catch exactly this), and nesting a different
  // component's state setter inside one is a side effect hiding there.
  const handleDroneCapturePoint = useCallback((point: LatLng) => {
    setDronePoints((prev) => [...prev, point])
    setLiveWalkPath((prev) => [...prev, point])
  }, [])

  const handleDronePointsChange = useCallback((points: LatLng[]) => {
    setDronePoints(points)
    // Mirror drone points into the live walk path so the map visualizes them
    setLiveWalkPath(points)
  }, [])

  const handleStartDroneCapture = useCallback(() => {
    setDroneCaptureActive(true)
    setDrawTarget(null)
    setDronePoints([])
    setLiveWalkPath([])
  }, [])

  const handleStopDroneCapture = useCallback(() => {
    setDroneCaptureActive(false)
    setDronePoints([])
    setLiveWalkPath([])
  }, [])

  const handleDroneCaptureComplete = useCallback((vertices: LatLng[]) => {
    setBoundary(createBoundary(vertices, 'drone-walk'))
    setDroneCaptureActive(false)
    setDronePoints([])
    setLiveWalkPath([])
  }, [setBoundary])

  return (
    <AppShell onOpenProjects={() => setProjectsOpen(true)}>
      <ProjectsPanel open={projectsOpen} onClose={() => setProjectsOpen(false)} />
      <div className="flex flex-1 min-h-0">
        <aside className="w-[380px] shrink-0 overflow-hidden border-r border-(--border-subtle) bg-(--surface-app)">
          <div key={currentStep} className="panel-transition h-full">
            {currentStep === 'import' && (
              <ImportPanel
                drawTarget={drawTarget}
                onStartDrawBoundary={() => setDrawTarget('boundary')}
                onStartDrawZone={() => setDrawTarget('zone')}
                onStartDrawCircleZone={() => setDrawTarget('circle-zone')}
                onCancelDraw={() => setDrawTarget(null)}
                onGpsWalkPointsChange={setLiveWalkPath}
                onLocationSelected={handleLocationSelected}
                droneCaptureActive={droneCaptureActive}
                dronePoints={dronePoints}
                onDronePointsChange={handleDronePointsChange}
                onStartDroneCapture={handleStartDroneCapture}
                onStopDroneCapture={handleStopDroneCapture}
                onDroneCaptureComplete={handleDroneCaptureComplete}
                editingZoneId={editingZoneId}
                editingVertexIndex={editingVertexIndex}
                onStartEditZone={handleStartEditZone}
                onStopEditZone={handleZoneEditDone}
                onDeleteEditVertex={handleDeleteEditVertex}
              />
            )}
            {currentStep === 'verify' && (
              <VerifyPanel
                correctionTarget={correctionTarget}
                onStartWalkStrip={(edgeId) => setCorrectionTarget({ mode: 'walk-strip', edgeId })}
                onStartTrimEdge={(edgeId) => setCorrectionTarget({ mode: 'trim-edge', edgeId })}
                onCancelCorrection={() => setCorrectionTarget(null)}
              />
            )}
            {currentStep === 'plan' && (
              <PlanPanel cropRowTapActive={cropRowTapActive} onStartCropRowTap={() => setCropRowTapActive(true)} onCancelCropRowTap={() => setCropRowTapActive(false)} />
            )}
            {currentStep === 'simulate' && (
              <SimulatePanel onOverlayChange={setSimulateOverlay} onDronePositionChange={setDronePreviewPosition} />
            )}
            {currentStep === 'export' && <ExportPanel />}
            {currentStep === 'send' && <SendPanel onCenterOnDrone={handleCenterOnDrone} />}
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <FieldMap
            boundary={currentStep === 'simulate' ? null : boundary}
            fieldLoaded={boundary !== null}
            noSprayZones={noSprayZones}
            sprayPlan={sprayPlan}
            planSplitPercent={planSplitPercent}
            planSplitDirection={planSplitDirection}
            projection={projection}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={setSelectedEdgeId}
            showEdges={currentStep === 'verify'}
            showZones={currentStep !== 'send' && currentStep !== 'simulate'}
            showPlan={currentStep === 'plan' || currentStep === 'simulate' || currentStep === 'export' || currentStep === 'send'}
            drawTarget={drawTarget}
            onDrawFinish={handleDrawFinish}
            onDrawCancel={() => setDrawTarget(null)}
            onCircleZoneFinish={handleCircleZoneFinish}
            editingZoneId={editingZoneId}
            editingVertexIndex={editingVertexIndex}
            onZoneEdit={handleZoneEdit}
            onEditVertexSelect={setEditingVertexIndex}
            onDeleteEditVertex={handleDeleteEditVertex}
            onZoneEditDone={handleZoneEditDone}
            liveWalkPath={liveWalkPath}
            droneCaptureActive={droneCaptureActive}
            onDroneCapturePoint={handleDroneCapturePoint}
            correctionTarget={correctionTarget}
            onCorrectionFinish={handleCorrectionFinish}
            onCorrectionCancel={() => setCorrectionTarget(null)}
            cropRowTapActive={cropRowTapActive}
            onCropRowTap={handleCropRowTap}
            simulateOverlay={simulateOverlay}
            dronePosition={currentStep === 'simulate' ? dronePreviewPosition : null}
            flyTo={flyTo}
          />
        </div>
      </div>
    </AppShell>
  )
}

export default App
