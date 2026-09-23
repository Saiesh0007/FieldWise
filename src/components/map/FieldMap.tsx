import {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  NavigationControl,
  type LngLatBoundsLike,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState } from 'react'
import { PhoneFrameOverlay } from '@/components/map/PhoneFrameOverlay'
import { Button } from '@/components/ui/Button'
import { circleToPolygon } from '@/lib/geo/circleObstacle'
import { createLocalProjection, type LocalProjection } from '@/lib/geo/projection'
import { SAMPLE_FIELD_CENTER } from '@/lib/geo/sampleField'
import type { FieldBoundary, LatLng, NoSprayZone, SprayPlan } from '@/lib/geo/types'
import { SATELLITE_LAYER_ID, SATELLITE_SOURCE_ID, SATELLITE_STYLE, setBaseMapMode, type BaseMapMode } from '@/lib/map/basemap'
import { onTileSourceStatusChange, registerResilientSatelliteProtocol, retryTileSource } from '@/lib/map/resilientSatelliteTiles'
import {
  accuracyCircleFeature,
  boundaryEdgesToFeatureCollection,
  boundaryToPolygonFeature,
  boundsOfLatLng,
  EMPTY_FEATURE_COLLECTION,
  heatmapToFeatureCollection,
  latLngLineFeature,
  latLngPointFeature,
  polygonFeatureFromRing,
  sprayPlanToFeatureCollections,
  zonesToFeatureCollection,
} from '@/lib/map/geojson'
import { PROVENANCE_COLORS } from '@/lib/map/provenanceColors'
import type { ReplayHeatmap } from '@/lib/simulation/replay'

// Registered once at module load, before any Map instance requests a
// tile — MapLibre resolves the fwsat:// scheme lazily on first use, but
// registering it eagerly here means it's never a race against the
// map's own initial tile requests.
registerResilientSatelliteProtocol()

const SOURCE = {
  boundaryFill: 'boundary-fill',
  boundaryEdges: 'boundary-edges',
  zones: 'zones',
  sprayLines: 'spray-lines',
  transitLines: 'transit-lines',
  homePoint: 'home-point',
  drawProgress: 'draw-progress',
  drawProgressPoints: 'draw-progress-points',
  walkTrace: 'walk-trace',
  pilotAccuracy: 'pilot-accuracy',
  pilotMarker: 'pilot-marker',
  simGroundTruth: 'sim-ground-truth',
  simActiveBoundary: 'sim-active-boundary',
  heatmap: 'heatmap',
  circlePreview: 'circle-preview',
  circleCenterPoint: 'circle-center-point',
  zoneEditHandles: 'zone-edit-handles',
} as const

export type DrawTarget = 'boundary' | 'zone' | 'circle-zone' | null

/** When true the map is in "drone point capture" mode — each click fires onDroneCapturePoint. */
export type DroneCaptureMode = boolean

/** "Walk a strip" and "trim an edge" are the same underlying delta merge (see lib/geo/delta.ts) — mode only changes which way the pilot marker starts nudged and the overlay's copy. */
export interface CorrectionTarget {
  mode: 'walk-strip' | 'trim-edge'
  edgeId: string
}

const MIN_TRACE_POINT_GAP_M = 2.5

interface FieldMapProps {
  boundary: FieldBoundary | null
  noSprayZones: NoSprayZone[]
  sprayPlan: SprayPlan | null
  projection: LocalProjection | null
  selectedEdgeId: string | null
  onSelectEdge: (edgeId: string | null) => void
  showEdges: boolean
  showZones: boolean
  showPlan: boolean
  drawTarget: DrawTarget
  onDrawFinish: (vertices: LatLng[]) => void
  onDrawCancel: () => void
  /**
   * Circle-shaped obstacle ("Add Obstacle" → Circle): first click places
   * the center, second click sets the radius and fires this — only used
   * when drawTarget === 'circle-zone'.
   */
  onCircleZoneFinish?: (center: LatLng, radiusM: number) => void

  /**
   * Edit Obstacle (AeroGCS Green §12.3) — while set, the named zone's
   * vertices render as draggable handles: dragging one on a polygon
   * zone repositions just that vertex; dragging the (single) handle on
   * a circle zone resizes it, keeping it a true circle. A plain click
   * (no drag) on a handle selects it via onEditVertexSelect, for the
   * panel's "Delete point" action; clicking empty map deselects.
   */
  editingZoneId?: string | null
  editingVertexIndex?: number | null
  onZoneEdit?: (id: string, update: { vertices: LatLng[]; radiusM?: number }) => void
  onEditVertexSelect?: (index: number | null) => void
  /** "Delete point" — only offered for a selected vertex on a polygon zone with more than 3 vertices. */
  onDeleteEditVertex?: () => void
  onZoneEditDone?: () => void
  /** In-progress GPS walk points (real or simulated), drawn the same way as a click-drawn polygon. */
  liveWalkPath?: LatLng[]

  /**
   * Drone point-capture mode — when true, each map click fires onDroneCapturePoint
   * with the clicked coordinate instead of adding to the boundary-draw polygon.
   * The drone-crosshair overlay is shown and map cursor is crosshair.
   */
  droneCaptureActive?: boolean
  /** Called for every map click while droneCaptureActive is true. */
  onDroneCapturePoint?: (point: LatLng) => void

  /** Drag-the-pilot-marker correction — "walk a strip" / "trim an edge". */
  correctionTarget: CorrectionTarget | null
  onCorrectionFinish: (trace: LatLng[], accuracyM: number) => void
  onCorrectionCancel: () => void

  /** Tap-two-points-along-a-row correction. */
  cropRowTapActive: boolean
  onCropRowTap: (a: LatLng, b: LatLng) => void

  /** Blind vs. Sighted replay: the scored boundary + heatmap for whichever run is currently being viewed. */
  simulateOverlay: SimulateOverlay | null

  /**
   * A place search result or "use my current location" request — purely
   * a camera move, never touches boundary/session state. A new object
   * (even with identical coordinates to the last one) re-triggers the
   * fly/fit; App.tsx creates a fresh object per selection for exactly
   * that reason.
   */
  flyTo: FlyToRequest | null
}

export interface FlyToRequest {
  lat: number
  lon: number
  /** [south, north, west, east] — when present, the camera fits this whole extent rather than a fixed zoom level. */
  boundingBox: [number, number, number, number] | null
}

export interface SimulateOverlay {
  groundTruthLatLng: LatLng[]
  activeBoundaryLatLng: LatLng[]
  /** Hex — amber for the Blind (satellite) run, blue for the Sighted (corrected) run. */
  activeColor: string
  heatmap: ReplayHeatmap
  /**
   * The scenario's OWN local projection — the heatmap's cell coordinates
   * are local meters relative to the scenario's own origin, which is a
   * different place than wherever the live boundary (if any) is
   * centered. Bundled here rather than reusing the outer `projection`
   * prop so this never silently unprojects against the wrong origin.
   */
  projection: LocalProjection
  /** Animation cursor: spraying passes with doseOrder <= this are revealed; 'missed' cells reveal once this reaches the end. */
  revealedThroughStep: number
}

function setData(map: MapLibreMap, sourceId: string, data: GeoJSON.GeoJSON) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined
  source?.setData(data)
}

/**
 * A starting point for the draggable pilot marker: the target edge's
 * midpoint, nudged a few meters along its outward normal (or inward, for
 * a trim). "Outward" is approximated as away from the projection's local
 * origin — a reasonable proxy for the field's interior at field scale.
 */
function nudgedEdgeMidpoint(
  boundary: FieldBoundary,
  edgeId: string,
  projection: LocalProjection,
  direction: 'out' | 'in',
): LatLng | null {
  const edge = boundary.edges.find((e) => e.id === edgeId)
  if (!edge) return null

  const a = projection.toLocal(boundary.vertices[edge.fromIndex])
  const b = projection.toLocal(boundary.vertices[edge.toIndex])
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const n1 = { x: -dy / len, y: dx / len }
  const outward = mid.x * n1.x + mid.y * n1.y >= 0 ? n1 : { x: -n1.x, y: -n1.y }
  const sign = direction === 'out' ? 1 : -1
  const nudged = { x: mid.x + outward.x * 4 * sign, y: mid.y + outward.y * 4 * sign }
  return projection.toLatLng(nudged)
}

export function FieldMap({
  boundary,
  noSprayZones,
  sprayPlan,
  projection,
  selectedEdgeId,
  onSelectEdge,
  showEdges,
  showZones,
  showPlan,
  drawTarget,
  onDrawFinish,
  onDrawCancel,
  onCircleZoneFinish,
  editingZoneId = null,
  editingVertexIndex = null,
  onZoneEdit,
  onEditVertexSelect,
  onDeleteEditVertex,
  onZoneEditDone,
  liveWalkPath = [],
  droneCaptureActive = false,
  onDroneCapturePoint,
  correctionTarget,
  onCorrectionFinish,
  onCorrectionCancel,
  cropRowTapActive,
  onCropRowTap,
  simulateOverlay,
  flyTo,
}: FieldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [drawVertices, setDrawVertices] = useState<LatLng[]>([])

  // Circle obstacle draw session: first click sets the center, then the
  // live cursor position (and the next click) determine the radius.
  const [circleCenter, setCircleCenter] = useState<LatLng | null>(null)
  const [circleRadiusM, setCircleRadiusM] = useState(0)

  // Edit Obstacle session: while a vertex/handle is being dragged, the
  // edited zone's live (uncommitted) vertices render locally — the store
  // only gets one update, on release, so this doesn't trigger a full
  // re-plan on every pixel of drag.
  const [liveEditVertices, setLiveEditVertices] = useState<LatLng[] | null>(null)
  const liveEditVerticesRef = useRef<LatLng[] | null>(null)
  liveEditVerticesRef.current = liveEditVertices
  const isDraggingZoneVertexRef = useRef(false)
  const dragVertexIndexRef = useRef<number | null>(null)
  /** Whether the current handle mousedown actually moved — a click handler fires right after mouseup even following a drag, and this tells it to swallow that click instead of treating it as a fresh select/deselect tap. */
  const zoneVertexDragMovedRef = useRef(false)

  const lastFittedBoundaryId = useRef<string | null>(null)
  const [usingFallbackTiles, setUsingFallbackTiles] = useState(false)
  const [baseMapMode, setBaseMapModeState] = useState<BaseMapMode>('satellite')

  // Correction (walk-strip / trim-edge) drag session state.
  const [walkTrace, setWalkTrace] = useState<LatLng[]>([])
  const [pilotPosition, setPilotPosition] = useState<LatLng | null>(null)
  const [accuracyM, setAccuracyM] = useState(4)
  const isDraggingPilotRef = useRef(false)

  // Crop-row tap session state.
  const [cropRowTapPoints, setCropRowTapPoints] = useState<LatLng[]>([])

  // Refs so the map's event handlers (registered once) always see the
  // latest callback/props without needing to be re-registered.
  const drawTargetRef = useRef(drawTarget)
  drawTargetRef.current = drawTarget
  const showEdgesRef = useRef(showEdges)
  showEdgesRef.current = showEdges
  const onSelectEdgeRef = useRef(onSelectEdge)
  onSelectEdgeRef.current = onSelectEdge
  const projectionRef = useRef(projection)
  projectionRef.current = projection
  const accuracyMRef = useRef(accuracyM)
  accuracyMRef.current = accuracyM
  const correctionActiveRef = useRef(correctionTarget !== null)
  correctionActiveRef.current = correctionTarget !== null
  const cropRowTapActiveRef = useRef(cropRowTapActive)
  cropRowTapActiveRef.current = cropRowTapActive
  const onCropRowTapRef = useRef(onCropRowTap)
  onCropRowTapRef.current = onCropRowTap
  const droneCaptureActiveRef = useRef(droneCaptureActive)
  droneCaptureActiveRef.current = droneCaptureActive
  const onDroneCapturePointRef = useRef(onDroneCapturePoint)
  onDroneCapturePointRef.current = onDroneCapturePoint
  const circleCenterRef = useRef(circleCenter)
  circleCenterRef.current = circleCenter
  const onCircleZoneFinishRef = useRef(onCircleZoneFinish)
  onCircleZoneFinishRef.current = onCircleZoneFinish
  const editingZoneIdRef = useRef(editingZoneId)
  editingZoneIdRef.current = editingZoneId
  const noSprayZonesRef = useRef(noSprayZones)
  noSprayZonesRef.current = noSprayZones
  const onZoneEditRef = useRef(onZoneEdit)
  onZoneEditRef.current = onZoneEdit
  const onEditVertexSelectRef = useRef(onEditVertexSelect)
  onEditVertexSelectRef.current = onEditVertexSelect

  // Drawing is reset whenever the target changes (including turning off).
  useEffect(() => {
    setDrawVertices([])
    setCircleCenter(null)
    setCircleRadiusM(0)
  }, [drawTarget])

  // Edit-obstacle session is reset whenever the target zone changes
  // (including leaving edit mode entirely).
  useEffect(() => {
    setLiveEditVertices(null)
    isDraggingZoneVertexRef.current = false
    dragVertexIndexRef.current = null
  }, [editingZoneId])

  // Tracks whether any currently-loaded satellite tile actually came
  // from the backup provider (see resilientSatelliteTiles.ts) — drives
  // the "showing backup map" banner below.
  useEffect(() => {
    return onTileSourceStatusChange((status) => setUsingFallbackTiles(status.usingFallback))
  }, [])

  // Crop-row tap points reset whenever the mode toggles.
  useEffect(() => {
    setCropRowTapPoints([])
  }, [cropRowTapActive])

  // Starting a correction session: seed the pilot marker at a nudged
  // midpoint of the target edge and pick a fresh simulated GPS accuracy
  // (a real phone's fix quality drifts session to session, so this isn't
  // pretending to be more precise than that). Keyed on the target's
  // identity, not on boundary/projection references, so this doesn't
  // reset mid-drag if something unrelated recomputes.
  const correctionKey = correctionTarget ? `${correctionTarget.mode}:${correctionTarget.edgeId}` : null
  useEffect(() => {
    if (!correctionTarget) {
      setPilotPosition(null)
      setWalkTrace([])
      return
    }
    const b = boundary
    const proj = projection
    if (!b || !proj) return
    const start = nudgedEdgeMidpoint(b, correctionTarget.edgeId, proj, correctionTarget.mode === 'walk-strip' ? 'out' : 'in')
    setPilotPosition(start)
    setWalkTrace([])
    setAccuracyM(3 + Math.random() * 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on correctionKey, not boundary/projection identity
  }, [correctionKey])

  // Disable map panning for the whole correction session (not just
  // during the mousedown-on-marker window) — doing this reactively
  // inside the mousedown handler loses a race against MapLibre's own
  // built-in drag-pan handler, which can already start panning before a
  // same-event listener gets a chance to call dragPan.disable().
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (correctionTarget || editingZoneId) {
      map.dragPan.disable()
    } else {
      map.dragPan.enable()
    }
  }, [correctionTarget, editingZoneId])

  // ---- Map lifecycle -----------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [SAMPLE_FIELD_CENTER.lon, SAMPLE_FIELD_CENTER.lat],
      zoom: 16.5,
      attributionControl: { compact: true },
    })
    mapRef.current = map

    // Dev-only debug hook (never ships in production builds) — lets a
    // browser-driven verification script (Playwright etc.) project
    // lngLat to screen pixels for the drag interactions, without any
    // app code needing to know it's being watched.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __fieldwiseMap?: MapLibreMap }).__fieldwiseMap = map
    }

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      map.addSource(SOURCE.boundaryFill, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'boundary-fill-layer',
        type: 'fill',
        source: SOURCE.boundaryFill,
        paint: { 'fill-color': '#279d82', 'fill-opacity': 0.12 },
      })

      map.addSource(SOURCE.boundaryEdges, {
        type: 'geojson',
        data: EMPTY_FEATURE_COLLECTION,
        promoteId: 'edgeId',
      })
      // Wide, invisible line purely for generous click/hover hit-testing.
      map.addLayer({
        id: 'boundary-edges-hit',
        type: 'line',
        source: SOURCE.boundaryEdges,
        paint: { 'line-width': 18, 'line-opacity': 0 },
      })
      // Selection halo, drawn under the colored edges.
      map.addLayer({
        id: 'boundary-edges-selection',
        type: 'line',
        source: SOURCE.boundaryEdges,
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 9,
          'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.9, 0],
        },
      })
      // Verified edges (walked/confirmed) — solid.
      map.addLayer({
        id: 'boundary-edges-verified',
        type: 'line',
        source: SOURCE.boundaryEdges,
        filter: ['!=', ['get', 'provenance'], 'satellite'],
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'provenance'],
            'walked',
            PROVENANCE_COLORS.walked,
            'confirmed',
            PROVENANCE_COLORS.confirmed,
            PROVENANCE_COLORS.confirmed,
          ],
          'line-width': 4,
        },
      })
      // Unverified (satellite prior) edges — dashed amber, the twist's core visual.
      map.addLayer({
        id: 'boundary-edges-unverified',
        type: 'line',
        source: SOURCE.boundaryEdges,
        filter: ['all', ['==', ['get', 'provenance'], 'satellite'], ['!=', ['get', 'acceptedRisk'], true]],
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': PROVENANCE_COLORS.satellite,
          'line-width': 4,
          'line-dasharray': [2, 1.6],
        },
      })
      // Risk explicitly accepted without walking — dashed violet, deliberately never "walked" blue.
      map.addLayer({
        id: 'boundary-edges-accepted',
        type: 'line',
        source: SOURCE.boundaryEdges,
        filter: ['all', ['==', ['get', 'provenance'], 'satellite'], ['==', ['get', 'acceptedRisk'], true]],
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': PROVENANCE_COLORS.accepted,
          'line-width': 4,
          'line-dasharray': [3, 1.4],
        },
      })

      map.addSource(SOURCE.zones, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: SOURCE.zones,
        paint: { 'fill-color': '#dc2626', 'fill-opacity': 0.25 },
      })
      map.addLayer({
        id: 'zones-outline',
        type: 'line',
        source: SOURCE.zones,
        paint: { 'line-color': '#dc2626', 'line-width': 2, 'line-dasharray': [1, 1] },
      })

      // Circle-obstacle draw session preview: the ring-so-far plus a dot at the center.
      map.addSource(SOURCE.circlePreview, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'circle-preview-fill',
        type: 'fill',
        source: SOURCE.circlePreview,
        paint: { 'fill-color': '#dc2626', 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: 'circle-preview-outline',
        type: 'line',
        source: SOURCE.circlePreview,
        paint: { 'line-color': '#dc2626', 'line-width': 2 },
      })
      map.addSource(SOURCE.circleCenterPoint, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'circle-center-point-layer',
        type: 'circle',
        source: SOURCE.circleCenterPoint,
        paint: { 'circle-radius': 5, 'circle-color': '#dc2626', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
      })

      // Edit Obstacle: draggable vertex handles for whichever zone is
      // currently being edited — a wide invisible layer for generous
      // hit-testing (matching the pilot-marker pattern) under the small
      // visible dot, with the selected vertex (candidate for deletion)
      // highlighted.
      map.addSource(SOURCE.zoneEditHandles, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'zone-edit-handle-hit',
        type: 'circle',
        source: SOURCE.zoneEditHandles,
        paint: { 'circle-radius': 16, 'circle-opacity': 0 },
      })
      map.addLayer({
        id: 'zone-edit-handle-dot',
        type: 'circle',
        source: SOURCE.zoneEditHandles,
        paint: {
          'circle-radius': 6,
          'circle-color': ['case', ['boolean', ['get', 'selected'], false], '#7c3aed', '#2563eb'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })

      // Spray plan: spraying legs solid, transit legs dashed — kept as
      // two separate layers/sources rather than one data-driven layer
      // because line-dasharray isn't a data-expression-safe paint
      // property, and because "solid vs dashed" needs to stay
      // unambiguous at a glance during the demo.
      map.addSource(SOURCE.sprayLines, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'spray-lines-layer',
        type: 'line',
        source: SOURCE.sprayLines,
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#1a7e69', 'line-width': 2.5 },
      })
      map.addSource(SOURCE.transitLines, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'transit-lines-layer',
        type: 'line',
        source: SOURCE.transitLines,
        paint: { 'line-color': '#8691a2', 'line-width': 1.5, 'line-dasharray': [1.5, 1.5] },
      })

      map.addSource(SOURCE.homePoint, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'home-point-layer',
        type: 'circle',
        source: SOURCE.homePoint,
        paint: {
          'circle-radius': 7,
          'circle-color': '#ffffff',
          'circle-stroke-color': '#164f46',
          'circle-stroke-width': 3,
        },
      })

      // In-progress drawing (click-to-add or live GPS walk).
      map.addSource(SOURCE.drawProgress, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'draw-progress-line',
        type: 'line',
        source: SOURCE.drawProgress,
        paint: { 'line-color': '#2563eb', 'line-width': 3, 'line-dasharray': [1, 1] },
      })
      map.addSource(SOURCE.drawProgressPoints, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'draw-progress-points-layer',
        type: 'circle',
        source: SOURCE.drawProgressPoints,
        paint: { 'circle-radius': 5, 'circle-color': '#2563eb', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
      })

      // Field-Truth Walk correction: the walked trace so far, the
      // simulated GPS accuracy ring, and the draggable pilot marker.
      map.addSource(SOURCE.walkTrace, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'walk-trace-line',
        type: 'line',
        source: SOURCE.walkTrace,
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': PROVENANCE_COLORS.walked, 'line-width': 3 },
      })
      map.addSource(SOURCE.pilotAccuracy, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'pilot-accuracy-fill',
        type: 'fill',
        source: SOURCE.pilotAccuracy,
        paint: { 'fill-color': PROVENANCE_COLORS.walked, 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: 'pilot-accuracy-outline',
        type: 'line',
        source: SOURCE.pilotAccuracy,
        paint: { 'line-color': PROVENANCE_COLORS.walked, 'line-width': 1, 'line-opacity': 0.5 },
      })
      map.addSource(SOURCE.pilotMarker, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      // Wide invisible layer purely so the marker is easy to grab.
      map.addLayer({
        id: 'pilot-marker-hit',
        type: 'circle',
        source: SOURCE.pilotMarker,
        paint: { 'circle-radius': 22, 'circle-opacity': 0 },
      })
      map.addLayer({
        id: 'pilot-marker-dot',
        type: 'circle',
        source: SOURCE.pilotMarker,
        paint: {
          'circle-radius': 8,
          'circle-color': PROVENANCE_COLORS.walked,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5,
        },
      })

      // Blind vs. Sighted replay: the heatmap (below) + the ground-truth
      // and active-boundary outlines (above it), so judges can see both
      // the score and exactly where each boundary sat relative to truth.
      map.addSource(SOURCE.heatmap, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'heatmap-fill',
        type: 'fill',
        source: SOURCE.heatmap,
        paint: {
          'fill-color': ['match', ['get', 'state'], 'covered', '#16a34a', 'missed', '#dc2626', 'overspray', '#f97316', '#999999'],
          'fill-opacity': 0.55,
        },
      })
      map.addSource(SOURCE.simGroundTruth, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'sim-ground-truth-outline',
        type: 'line',
        source: SOURCE.simGroundTruth,
        paint: { 'line-color': '#1a1d24', 'line-width': 2, 'line-dasharray': [3, 2] },
      })
      map.addSource(SOURCE.simActiveBoundary, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addLayer({
        id: 'sim-active-boundary-outline',
        type: 'line',
        source: SOURCE.simActiveBoundary,
        paint: { 'line-color': ['get', 'color'], 'line-width': 3 },
      })

      setLoaded(true)
      // Safety net: containers inside flex layouts sometimes report zero
      // size on first paint, before layout settles.
      requestAnimationFrame(() => map.resize())
    })

    map.on('click', (e: MapMouseEvent) => {
      // Drone point-capture mode takes first priority — each click emits
      // one point at the clicked coordinate (the "drone's current position").
      if (droneCaptureActiveRef.current) {
        onDroneCapturePointRef.current?.({ lon: e.lngLat.lng, lat: e.lngLat.lat })
        return
      }
      if (editingZoneIdRef.current) {
        // A click fires right after mouseup even following a drag —
        // swallow it here rather than reinterpreting the drag's release
        // as a fresh select/deselect tap.
        if (zoneVertexDragMovedRef.current) {
          zoneVertexDragMovedRef.current = false
          return
        }
        const features = map.queryRenderedFeatures(e.point, { layers: ['zone-edit-handle-hit'] })
        const idx = features[0]?.properties?.vertexIndex as number | undefined
        onEditVertexSelectRef.current?.(idx ?? null)
        return
      }
      if (drawTargetRef.current === 'circle-zone') {
        const clicked: LatLng = { lon: e.lngLat.lng, lat: e.lngLat.lat }
        if (!circleCenterRef.current) {
          setCircleCenter(clicked)
        } else {
          const proj = createLocalProjection(circleCenterRef.current)
          const local = proj.toLocal(clicked)
          const radiusM = Math.max(1, Math.hypot(local.x, local.y))
          onCircleZoneFinishRef.current?.(circleCenterRef.current, radiusM)
          setCircleCenter(null)
          setCircleRadiusM(0)
        }
        return
      }
      if (drawTargetRef.current) {
        setDrawVertices((prev) => [...prev, { lon: e.lngLat.lng, lat: e.lngLat.lat }])
        return
      }
      if (cropRowTapActiveRef.current) {
        const point: LatLng = { lon: e.lngLat.lng, lat: e.lngLat.lat }
        setCropRowTapPoints((prev) => {
          const next = [...prev, point]
          if (next.length === 2) {
            onCropRowTapRef.current(next[0], next[1])
            return []
          }
          return next
        })
        return
      }
      if (!showEdgesRef.current) return
      const features = map.queryRenderedFeatures(e.point, { layers: ['boundary-edges-hit'] })
      const edgeId = features[0]?.properties?.edgeId as string | undefined
      onSelectEdgeRef.current(edgeId ?? null)
    })

    map.on('mouseenter', 'boundary-edges-hit', () => {
      if (!drawTargetRef.current) map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'boundary-edges-hit', () => {
      if (!drawTargetRef.current) map.getCanvas().style.cursor = ''
    })

    // Field-Truth Walk: drag the pilot marker to record a trace. The
    // recorded points get a small random jitter around the true drag
    // position — the marker itself tracks the cursor exactly, but what
    // gets fed into the boundary correction is jittered within the
    // session's simulated GPS accuracy, same as a real fix would be.
    //
    // The trace must be 100% drag-controlled: it only extends while the
    // mouse button is actually held down over the map, and stops the
    // instant it's released — never auto-continuing on its own. MapLibre's
    // own `mouseup` is scoped to the map canvas, so releasing the button
    // outside it (trivially easy with the 380px sidebar right there) would
    // never fire it, leaving isDraggingPilotRef stuck `true` and turning
    // the next plain mouse-move-with-no-button-held into an unwanted trace
    // extension. Two independent fixes for that one failure mode: a
    // `buttons` check inside mousemove itself (self-healing — stops on
    // the very next move regardless of where the release happened) and a
    // window-level mouseup listener (so the cursor/grab state also resets
    // correctly even when the release lands off-canvas).
    const stopDraggingPilot = () => {
      if (!isDraggingPilotRef.current) return
      isDraggingPilotRef.current = false
      map.getCanvas().style.cursor = correctionActiveRef.current ? 'grab' : ''
    }

    // Edit Obstacle: drag a vertex handle. Same off-canvas-release
    // safety net as the pilot marker above (a `buttons` check inside
    // mousemove, plus a window-level mouseup listener).
    const stopDraggingZoneVertex = () => {
      if (!isDraggingZoneVertexRef.current) return
      isDraggingZoneVertexRef.current = false
      map.getCanvas().style.cursor = editingZoneIdRef.current ? 'grab' : ''
      const zoneId = editingZoneIdRef.current
      const vertices = liveEditVerticesRef.current
      if (zoneId && vertices) {
        const zone = noSprayZonesRef.current.find((z) => z.id === zoneId)
        let radiusM: number | undefined
        if (zone?.shape === 'circle' && zone.center) {
          const local = createLocalProjection(zone.center).toLocal(vertices[0])
          radiusM = Math.hypot(local.x, local.y)
        }
        onZoneEditRef.current?.(zoneId, { vertices, radiusM })
      }
      // The commit above updates the store; drop the local live-preview
      // override so subsequent renders read from that fresh store data
      // instead of this now-stale drag snapshot (a later action — like
      // deleting a different vertex — would otherwise keep rendering
      // this stale array and appear to silently no-op).
      setLiveEditVertices(null)
      dragVertexIndexRef.current = null
    }

    map.on('mousedown', 'zone-edit-handle-hit', (e) => {
      if (!editingZoneIdRef.current) return
      const idx = e.features?.[0]?.properties?.vertexIndex as number | undefined
      if (idx === undefined) return
      e.preventDefault()
      isDraggingZoneVertexRef.current = true
      zoneVertexDragMovedRef.current = false
      dragVertexIndexRef.current = idx
      map.getCanvas().style.cursor = 'grabbing'
    })
    map.on('mouseenter', 'zone-edit-handle-hit', () => {
      if (editingZoneIdRef.current) map.getCanvas().style.cursor = 'grab'
    })
    map.on('mouseleave', 'zone-edit-handle-hit', () => {
      if (editingZoneIdRef.current && !isDraggingZoneVertexRef.current) map.getCanvas().style.cursor = ''
    })

    map.on('mousedown', 'pilot-marker-hit', (e) => {
      if (!correctionActiveRef.current) return
      e.preventDefault()
      isDraggingPilotRef.current = true
      map.getCanvas().style.cursor = 'grabbing'
    })
    map.on('mouseenter', 'pilot-marker-hit', () => {
      if (correctionActiveRef.current) map.getCanvas().style.cursor = 'grab'
    })
    map.on('mouseleave', 'pilot-marker-hit', () => {
      if (correctionActiveRef.current && !isDraggingPilotRef.current) map.getCanvas().style.cursor = ''
    })
    map.on('mousemove', (e: MapMouseEvent) => {
      if (drawTargetRef.current === 'circle-zone' && circleCenterRef.current) {
        const hovered: LatLng = { lon: e.lngLat.lng, lat: e.lngLat.lat }
        const proj = createLocalProjection(circleCenterRef.current)
        const local = proj.toLocal(hovered)
        setCircleRadiusM(Math.max(1, Math.hypot(local.x, local.y)))
      }
      if (isDraggingZoneVertexRef.current) {
        if (e.originalEvent.buttons === 0) {
          stopDraggingZoneVertex()
        } else {
          zoneVertexDragMovedRef.current = true
          const zoneId = editingZoneIdRef.current
          const idx = dragVertexIndexRef.current
          const zone = zoneId ? noSprayZonesRef.current.find((z) => z.id === zoneId) : undefined
          if (zone && idx !== null) {
            const hovered: LatLng = { lon: e.lngLat.lng, lat: e.lngLat.lat }
            if (zone.shape === 'circle' && zone.center) {
              // Any point on a circle's edge resizes it uniformly — regenerate the whole ring from the new radius, keeping it a true circle.
              const local = createLocalProjection(zone.center).toLocal(hovered)
              const radiusM = Math.max(1, Math.hypot(local.x, local.y))
              setLiveEditVertices(circleToPolygon(zone.center, radiusM))
            } else {
              const base = liveEditVerticesRef.current ?? zone.vertices
              const next = base.slice()
              next[idx] = hovered
              setLiveEditVertices(next)
            }
          }
        }
      }
      if (!isDraggingPilotRef.current) return
      if (e.originalEvent.buttons === 0) {
        // The button isn't actually held anymore — the release must have
        // happened outside the canvas. Stop here instead of treating this
        // move as a continued drag.
        stopDraggingPilot()
        return
      }
      const truePosition: LatLng = { lon: e.lngLat.lng, lat: e.lngLat.lat }
      setPilotPosition(truePosition)

      const proj = projectionRef.current
      if (!proj) return
      const accuracy = accuracyMRef.current
      const trueLocal = proj.toLocal(truePosition)
      const jitterAngle = Math.random() * Math.PI * 2
      const jitterMag = Math.random() * accuracy
      const jitteredLocal = {
        x: trueLocal.x + Math.cos(jitterAngle) * jitterMag,
        y: trueLocal.y + Math.sin(jitterAngle) * jitterMag,
      }
      const recordedPoint = proj.toLatLng(jitteredLocal)

      setWalkTrace((prev) => {
        const last = prev[prev.length - 1]
        if (last) {
          const lastLocal = proj.toLocal(last)
          const dist = Math.hypot(jitteredLocal.x - lastLocal.x, jitteredLocal.y - lastLocal.y)
          if (dist < MIN_TRACE_POINT_GAP_M) return prev
        }
        return [...prev, recordedPoint]
      })
    })
    map.on('mouseup', stopDraggingPilot)
    window.addEventListener('mouseup', stopDraggingPilot)
    map.on('mouseup', stopDraggingZoneVertex)
    window.addEventListener('mouseup', stopDraggingZoneVertex)

    return () => {
      window.removeEventListener('mouseup', stopDraggingPilot)
      window.removeEventListener('mouseup', stopDraggingZoneVertex)
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time map init; live values flow in via refs/effects below
  }, [])

  // Drawing / crop-row-tap / drone-capture cursor
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = drawTarget || cropRowTapActive || droneCaptureActive ? 'crosshair' : ''
  }, [drawTarget, cropRowTapActive, droneCaptureActive])

  // ---- Data sync effects ---------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    if (boundary) {
      setData(map, SOURCE.boundaryFill, boundaryToPolygonFeature(boundary))
      setData(map, SOURCE.boundaryEdges, boundaryEdgesToFeatureCollection(boundary))

      if (lastFittedBoundaryId.current !== boundary.id) {
        lastFittedBoundaryId.current = boundary.id
        const bounds = boundsOfLatLng(boundary.vertices) as LngLatBoundsLike
        map.fitBounds(bounds, { padding: 64, duration: 600 })
      }
    } else {
      setData(map, SOURCE.boundaryFill, EMPTY_FEATURE_COLLECTION)
      setData(map, SOURCE.boundaryEdges, EMPTY_FEATURE_COLLECTION)
      lastFittedBoundaryId.current = null
    }
  }, [boundary, loaded])

  // Place search / "use my current location" — purely a camera move.
  // Fits the whole result's extent when Nominatim gave one (a
  // village/city search reads very differently at a fixed zoom than an
  // exact address would); falls back to a fixed zoom for a bare point
  // (e.g. geolocation, which has no bounding box).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded || !flyTo) return

    if (flyTo.boundingBox) {
      const [south, north, west, east] = flyTo.boundingBox
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 64, duration: 1200, maxZoom: 17 },
      )
    } else {
      map.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: 16, duration: 1200 })
    }
  }, [flyTo, loaded])

  // Selection highlight (feature-state), independent of the data refresh above.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded || !boundary) return
    for (const edge of boundary.edges) {
      map.setFeatureState({ source: SOURCE.boundaryEdges, id: edge.id }, { selected: edge.id === selectedEdgeId })
    }
  }, [selectedEdgeId, boundary, loaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    // While a vertex of the edited zone is mid-drag, render that zone with
    // its live (uncommitted) vertices so the fill/outline reshapes in real
    // time — every other zone renders from the committed store data as usual.
    const renderedZones =
      editingZoneId && liveEditVertices
        ? noSprayZones.map((z) => (z.id === editingZoneId ? { ...z, vertices: liveEditVertices } : z))
        : noSprayZones
    setData(map, SOURCE.zones, zonesToFeatureCollection(renderedZones))
  }, [noSprayZones, editingZoneId, liveEditVertices, loaded])

  // Edit Obstacle: draggable vertex handles for the zone being edited.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    if (!editingZoneId) {
      setData(map, SOURCE.zoneEditHandles, EMPTY_FEATURE_COLLECTION)
      return
    }
    const zone = noSprayZones.find((z) => z.id === editingZoneId)
    if (!zone) {
      setData(map, SOURCE.zoneEditHandles, EMPTY_FEATURE_COLLECTION)
      return
    }
    const vertices = liveEditVertices ?? zone.vertices
    // A circle only needs one handle (any point on its edge resizes it
    // uniformly) — its own first vertex, always due east of center.
    const handleVertices = zone.shape === 'circle' ? vertices.slice(0, 1) : vertices

    const handles: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: handleVertices.map((v, i) => ({
        type: 'Feature',
        properties: { vertexIndex: i, selected: i === editingVertexIndex },
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
      })),
    }
    setData(map, SOURCE.zoneEditHandles, handles)
  }, [editingZoneId, editingVertexIndex, noSprayZones, liveEditVertices, loaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    if (sprayPlan && projection && sprayPlan.sorties.length > 0) {
      const { spray, transit } = sprayPlanToFeatureCollections(sprayPlan, projection)
      setData(map, SOURCE.sprayLines, spray)
      setData(map, SOURCE.transitLines, transit)
    } else {
      setData(map, SOURCE.sprayLines, EMPTY_FEATURE_COLLECTION)
      setData(map, SOURCE.transitLines, EMPTY_FEATURE_COLLECTION)
    }

    if (boundary && sprayPlan && sprayPlan.sorties.length > 0) {
      setData(map, SOURCE.homePoint, latLngPointFeature(boundary.vertices[0]))
    } else {
      setData(map, SOURCE.homePoint, EMPTY_FEATURE_COLLECTION)
    }
  }, [sprayPlan, projection, boundary, loaded])

  // Blind vs. Sighted replay overlay: ground truth + active boundary outlines, and the heatmap itself.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    if (!simulateOverlay) {
      setData(map, SOURCE.simGroundTruth, EMPTY_FEATURE_COLLECTION)
      setData(map, SOURCE.simActiveBoundary, EMPTY_FEATURE_COLLECTION)
      setData(map, SOURCE.heatmap, EMPTY_FEATURE_COLLECTION)
      return
    }

    setData(map, SOURCE.simGroundTruth, polygonFeatureFromRing(simulateOverlay.groundTruthLatLng))
    setData(
      map,
      SOURCE.simActiveBoundary,
      polygonFeatureFromRing(simulateOverlay.activeBoundaryLatLng, { color: simulateOverlay.activeColor }),
    )
    setData(
      map,
      SOURCE.heatmap,
      heatmapToFeatureCollection(simulateOverlay.heatmap, simulateOverlay.projection, simulateOverlay.revealedThroughStep),
    )

    if (lastFittedBoundaryId.current !== 'simulate-overlay') {
      lastFittedBoundaryId.current = 'simulate-overlay'
      const bounds = boundsOfLatLng([...simulateOverlay.groundTruthLatLng, ...simulateOverlay.activeBoundaryLatLng]) as LngLatBoundsLike
      map.fitBounds(bounds, { padding: 64, duration: 600 })
    }
  }, [simulateOverlay, loaded])

  // Layer visibility toggles.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const vis = (v: boolean) => (v ? 'visible' : 'none')
    for (const id of [
      'boundary-edges-hit',
      'boundary-edges-selection',
      'boundary-edges-verified',
      'boundary-edges-unverified',
      'boundary-edges-accepted',
    ]) {
      map.setLayoutProperty(id, 'visibility', vis(showEdges))
    }
  }, [showEdges, loaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const vis = (v: boolean) => (v ? 'visible' : 'none')
    map.setLayoutProperty('zones-fill', 'visibility', vis(showZones))
    map.setLayoutProperty('zones-outline', 'visibility', vis(showZones))
  }, [showZones, loaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const vis = (v: boolean) => (v ? 'visible' : 'none')
    for (const id of ['spray-lines-layer', 'transit-lines-layer', 'home-point-layer']) {
      map.setLayoutProperty(id, 'visibility', vis(showPlan))
    }
  }, [showPlan, loaded])

  // In-progress draw / live walk visualization — whichever is active.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const points = drawTarget ? drawVertices : liveWalkPath

    if (points.length === 0) {
      setData(map, SOURCE.drawProgress, EMPTY_FEATURE_COLLECTION)
      setData(map, SOURCE.drawProgressPoints, EMPTY_FEATURE_COLLECTION)
      return
    }

    const closed = points.length >= 3 ? [...points, points[0]] : points
    setData(map, SOURCE.drawProgress, latLngLineFeature(closed))
    setData(map, SOURCE.drawProgressPoints, {
      type: 'FeatureCollection',
      features: points.map((p) => latLngPointFeature(p)),
    })
  }, [drawVertices, liveWalkPath, drawTarget, loaded])

  // Circle-obstacle draw session preview.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    if (drawTarget !== 'circle-zone' || !circleCenter) {
      setData(map, SOURCE.circlePreview, EMPTY_FEATURE_COLLECTION)
      setData(map, SOURCE.circleCenterPoint, EMPTY_FEATURE_COLLECTION)
      return
    }

    setData(map, SOURCE.circleCenterPoint, latLngPointFeature(circleCenter))
    setData(map, SOURCE.circlePreview, circleRadiusM > 0 ? accuracyCircleFeature(circleCenter, circleRadiusM) : EMPTY_FEATURE_COLLECTION)
  }, [drawTarget, circleCenter, circleRadiusM, loaded])

  // Crop-row tap points — same visual language (dots + connecting line),
  // reusing the draw-progress layers since the two modes never overlap.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded || drawTarget || liveWalkPath.length > 0) return
    if (cropRowTapPoints.length === 0) {
      setData(map, SOURCE.drawProgress, EMPTY_FEATURE_COLLECTION)
      setData(map, SOURCE.drawProgressPoints, EMPTY_FEATURE_COLLECTION)
      return
    }
    setData(map, SOURCE.drawProgress, latLngLineFeature(cropRowTapPoints))
    setData(map, SOURCE.drawProgressPoints, {
      type: 'FeatureCollection',
      features: cropRowTapPoints.map((p) => latLngPointFeature(p)),
    })
  }, [cropRowTapPoints, drawTarget, liveWalkPath, loaded])

  // Field-Truth Walk correction: pilot marker, accuracy ring, and trace.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    if (!correctionTarget || !pilotPosition) {
      setData(map, SOURCE.pilotMarker, EMPTY_FEATURE_COLLECTION)
      setData(map, SOURCE.pilotAccuracy, EMPTY_FEATURE_COLLECTION)
      setData(map, SOURCE.walkTrace, EMPTY_FEATURE_COLLECTION)
      return
    }

    setData(map, SOURCE.pilotMarker, latLngPointFeature(pilotPosition))
    setData(map, SOURCE.pilotAccuracy, accuracyCircleFeature(pilotPosition, accuracyM))
    setData(map, SOURCE.walkTrace, walkTrace.length >= 2 ? latLngLineFeature(walkTrace) : EMPTY_FEATURE_COLLECTION)
  }, [correctionTarget, pilotPosition, accuracyM, walkTrace, loaded])

  const showGetStarted = !boundary && !simulateOverlay && !drawTarget && !droneCaptureActive && liveWalkPath.length === 0

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {usingFallbackTiles && baseMapMode === 'satellite' && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-2.5 rounded-(--radius-card) border border-warning/30 bg-warning-bg px-3.5 py-2 text-xs text-warning shadow-(--shadow-panel)">
            <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
              <circle cx="8" cy="8" r="7" fill="currentColor" fillOpacity="0.15" />
              <path d="M8 5v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="8" cy="11" r="0.9" fill="currentColor" />
            </svg>
            <span className="font-medium">
              Satellite imagery had trouble loading — some tiles are showing a backup map instead.
            </span>
            <button
              type="button"
              onClick={() => mapRef.current && retryTileSource(mapRef.current, SATELLITE_SOURCE_ID, SATELLITE_LAYER_ID)}
              className="shrink-0 rounded-full border border-warning/40 bg-white/60 px-2.5 py-1 font-medium text-warning transition-colors hover:bg-white"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="absolute right-2.5 top-24 z-10">
        <button
          type="button"
          onClick={() => {
            const next = baseMapMode === 'satellite' ? 'street' : 'satellite'
            setBaseMapModeState(next)
            if (mapRef.current) setBaseMapMode(mapRef.current, next)
          }}
          title="Toggle between satellite and street map view"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-(--border-subtle) bg-(--surface-panel) text-(--text-secondary) shadow-(--shadow-panel) transition-colors hover:bg-(--surface-panel-raised)"
        >
          {baseMapMode === 'satellite' ? (
            // Currently satellite — icon hints at switching to the street/line map.
            <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M2 6l4-2 4 2 4-2v8l-4 2-4-2-4 2V6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M6 4v8M10 6v8" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          ) : (
            // Currently street — icon hints at switching to satellite imagery.
            <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
              <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 9.5 6 6l3 2.5 5-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>

      {showGetStarted && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-none max-w-xs rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel)/95 px-5 py-4 text-center shadow-(--shadow-panel) backdrop-blur-sm">
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" stroke="currentColor" strokeWidth="1.75" />
                <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.75" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-(--text-primary)">No field loaded yet</p>
            <p className="mt-1 text-xs text-(--text-secondary)">
              Load the sample field, trace a boundary on the map, walk it with GPS, or import a file — all from the
              panel on the left.
            </p>
          </div>
        </div>
      )}

      {drawTarget && drawTarget !== 'circle-zone' && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) px-4 py-2.5 shadow-(--shadow-panel)">
          <div className="flex items-center gap-3">
            <span className="text-sm text-(--text-primary)">
              Click the map to add points
              {drawVertices.length > 0 && <span className="text-(--text-muted)"> · {drawVertices.length} so far</span>}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={drawVertices.length === 0}
              onClick={() => setDrawVertices((prev) => prev.slice(0, -1))}
            >
              Undo
            </Button>
            <Button size="sm" variant="secondary" onClick={onDrawCancel}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={drawVertices.length < 3} onClick={() => onDrawFinish(drawVertices)}>
              Finish ({drawVertices.length})
            </Button>
          </div>
        </div>
      )}

      {drawTarget === 'circle-zone' && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) px-4 py-2.5 shadow-(--shadow-panel)">
          <div className="flex items-center gap-3">
            <span className="text-sm text-(--text-primary)">
              {!circleCenter
                ? 'Click the map to place the obstacle center'
                : `Click again to set the radius${circleRadiusM > 0 ? ` — ${circleRadiusM.toFixed(1)}m` : ''}`}
            </span>
            {circleCenter && (
              <Button size="sm" variant="ghost" onClick={() => setCircleCenter(null)}>
                Undo center
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={onDrawCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {droneCaptureActive && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-(--radius-card) border border-brand-300/60 bg-(--surface-panel) px-4 py-2.5 shadow-(--shadow-panel)">
          <div className="flex items-center gap-2">
            {/* Drone icon */}
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true">
              <circle cx="10" cy="10" r="2.5" fill="currentColor" fillOpacity="0.3" stroke="currentColor" strokeWidth="1.4" />
              <path d="M4 4h2.5v2.5M13.5 4H16v2.5M4 16h2.5v-2.5M13.5 16H16v-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5.5 5.5L8 8M11.5 8L14.5 5M8 11.5L5 14.5M11.5 11.5L14.5 14.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span className="text-sm text-(--text-primary)">
              Drone mode — click map to place boundary point
            </span>
          </div>
        </div>
      )}

      {correctionTarget && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-(--radius-card) border border-provenance-walked/30 bg-(--surface-panel) px-4 py-2.5 shadow-(--shadow-panel)">
          <div className="flex items-center gap-3">
            <span className="text-sm text-(--text-primary)">
              {correctionTarget.mode === 'walk-strip' ? 'Drag the pilot marker to walk the strip' : 'Drag the pilot marker along the true edge'}
              {walkTrace.length > 0 && (
                <span className="text-(--text-muted)">
                  {' '}
                  · {walkTrace.length} point{walkTrace.length === 1 ? '' : 's'} · ±{accuracyM.toFixed(1)}m accuracy
                </span>
              )}
            </span>
            <Button size="sm" variant="secondary" onClick={onCorrectionCancel}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={walkTrace.length === 0} onClick={() => onCorrectionFinish(walkTrace, accuracyM)}>
              Finish walk
            </Button>
          </div>
        </div>
      )}

      {correctionTarget && boundary && projection && pilotPosition && (() => {
        const edge = boundary.edges.find((e) => e.id === correctionTarget.edgeId)
        if (!edge) return null
        return (
          <PhoneFrameOverlay
            mode={correctionTarget.mode}
            edgeA={projection.toLocal(boundary.vertices[edge.fromIndex])}
            edgeB={projection.toLocal(boundary.vertices[edge.toIndex])}
            walkTraceLocal={walkTrace.map((p) => projection.toLocal(p))}
            pilotPositionLocal={projection.toLocal(pilotPosition)}
            accuracyM={accuracyM}
            onFinish={() => onCorrectionFinish(walkTrace, accuracyM)}
            onCancel={onCorrectionCancel}
          />
        )
      })()}

      {cropRowTapActive && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) px-4 py-2.5 shadow-(--shadow-panel)">
          <span className="text-sm text-(--text-primary)">
            Tap two points along a visible crop row ({cropRowTapPoints.length}/2)
          </span>
        </div>
      )}

      {editingZoneId && (() => {
        const zone = noSprayZones.find((z) => z.id === editingZoneId)
        const canDeleteVertex = zone?.shape !== 'circle' && editingVertexIndex !== null && (zone?.vertices.length ?? 0) > 3
        return (
          <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) px-4 py-2.5 shadow-(--shadow-panel)">
            <div className="flex items-center gap-3">
              <span className="text-sm text-(--text-primary)">
                {zone?.shape === 'circle'
                  ? "Drag the circle's edge point to resize it."
                  : 'Drag a point to move it, or click one and Delete point to remove it.'}
              </span>
              {canDeleteVertex && (
                <Button size="sm" variant="secondary" onClick={onDeleteEditVertex}>
                  Delete point
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={onZoneEditDone}>
                Done
              </Button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
