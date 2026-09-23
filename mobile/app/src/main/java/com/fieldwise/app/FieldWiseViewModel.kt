package com.fieldwise.app

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fieldwise.correction.EditHistory
import com.fieldwise.demo.DemoField
import com.fieldwise.drone.DroneConnection
import com.fieldwise.drone.DroneSimulator
import com.fieldwise.drone.SimulationState
import com.fieldwise.map.GpsController
import com.fieldwise.map.GpsState
import com.fieldwise.map.MapActions
import com.fieldwise.map.MapState
import com.fieldwise.mission.ExportFormat
import com.fieldwise.mission.MissionRecord
import com.fieldwise.model.LatLng
import com.fieldwise.model.NoSprayZone
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.ZoneKind
import com.fieldwise.planner.SprayPathPlanner
import com.fieldwise.search.PlaceResult
import com.fieldwise.search.SearchOutcome
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Shared ViewModel for map state, flight planning, simulation, and mission history.
 */
class FieldWiseViewModel(
    private val gpsController: GpsController,
    context: Context
) : ViewModel() {
    private val fieldStore = FieldStore(context)
    private val historyStore = MissionHistoryStore(context)

    private val mutableMapState = MutableStateFlow(fieldStore.load() ?: MapState())
    val mapState: StateFlow<MapState> = mutableMapState

    private val mutableSimulationState = MutableStateFlow(SimulationState())
    val simulationState: StateFlow<SimulationState> = mutableSimulationState

    private val mutableMissionHistory = MutableStateFlow(historyStore.loadAll())
    val missions: StateFlow<List<MissionRecord>> = mutableMissionHistory

    private val mutableComparisonPlan = MutableStateFlow<com.fieldwise.model.SprayPlan?>(null)
    val comparisonPlan: StateFlow<com.fieldwise.model.SprayPlan?> = mutableComparisonPlan

    private var droneConnection: DroneConnection? = null
    private var currentPlan = mutableMapState.value.sprayState.plan

    init {
        // Wire GPS updates
        viewModelScope.launch {
            gpsController.gpsState.collect { gpsState ->
                mutableMapState.value = mutableMapState.value.withGpsState(gpsState)
            }
        }

        // Auto-save the field whenever MapState changes substantially (throttled).
        viewModelScope.launch {
            mutableMapState
                .distinctUntilChangedBy { it.persistKey() }
                .debounce(500)
                .collect { state ->
                    withContext(Dispatchers.IO) {
                        fieldStore.save(state)
                    }
                }
        }
    }

    fun mapActions(gpsController: GpsController): MapActions {
        return MapActions(
            onAddVertex = { addVertex(it) },
            onUndo = { undo() },
            onReset = {
                gpsController.stopAllTracking()
                resetField()
            },
            onLayerChange = { changeLayer(it) },
            onGpsStart = {
                if (!gpsController.hasLocationPermission()) {
                    // Permission would be requested in Activity
                } else if (!gpsController.startTracking()) {
                    mutableMapState.value = mutableMapState.value.withNotice("GPS walk could not start.")
                }
            },
            onGpsPause = { gpsController.pauseTracking() },
            onGpsResume = { gpsController.resumeTracking() },
            onGpsCancel = { gpsController.stopAllTracking() },
            onGpsFinish = {
                val capture = gpsController.finishTracking()
                if (capture != null) withWalkResult(capture)
                if (mutableMapState.value.boundaryState.pendingCorrection == null) gpsController.stopAllTracking()
            },
            onCorrectionAccept = {
                acceptPendingCorrection()
                gpsController.stopAllTracking()
            },
            onCorrectionReject = {
                rejectPendingCorrection()
                gpsController.stopAllTracking()
            },
            onSprayConfigChange = { updateSprayConfig(it) },
            onEditSprayParameters = { editSprayParameters() },
            onGenerateSprayPlan = { generateSprayPath() },
            onStartZone = { startZone(ZoneKind.WATER) },
            onZoneKind = { setZoneKind(it) },
            onFinishZone = { finishZone() },
            onCancelZone = { cancelZone() },
            onRemoveZone = { removeZone(it) },
            onOpenReview = { openReview() },
            onCloseReview = { closeReview() },
            onConfirmBoundary = { setBoundaryConfirmed(it) },
            onConfirmParameters = { setParametersConfirmed(it) },
            onConfirmMission = { confirmMission() },
            onExport = { exportMission(it) },
            onSearchQuery = { updateSearchQuery(it) },
            onSearchSubmit = { submitSearch() },
            onSearchPick = { choosePlace(it) },
            onSearchClear = { clearSearch() },
            onGoToMyLocation = { goToMyLocation() },
            onDismissNotice = { dismissNotice() }
        )
    }

    // ---- Actions: field and boundary ----

    fun createNewField() {
        mutableMapState.value = MapState()
    }

    fun loadDemoField() {
        val demoArea = DemoField.asGeoArea()
        val demoHistory = EditHistory.start(demoArea, emptyList())
        mutableMapState.value = MapState(
            fieldId = "DEMO-FIELD",
            fieldName = "Demo Field",
            vertices = DemoField.boundary.shell,
            boundaryState = com.fieldwise.map.BoundaryState(history = demoHistory),
            zones = DemoField.obstacles,
            sprayState = com.fieldwise.map.SprayState(config = DemoField.config),
            layer = com.fieldwise.map.MapLayer.SATELLITE,
            notice = "Demo field loaded: ${DemoField.boundary.shell.size} corners, ${DemoField.obstacles.size} obstacles"
        )
    }

    fun addVertex(p: LatLng) {
        mutableMapState.value = mutableMapState.value.withVertex(p)
    }

    fun undo() {
        mutableMapState.value = mutableMapState.value.undo()
    }

    fun resetField() {
        mutableMapState.value = mutableMapState.value.cleared()
    }

    fun changeLayer(layer: com.fieldwise.map.MapLayer) {
        mutableMapState.value = mutableMapState.value.withLayer(layer)
    }

    // ---- GPS and corrections ----

    fun updateGpsState(gpsState: com.fieldwise.map.GpsState) {
        mutableMapState.value = mutableMapState.value.withGpsState(gpsState)
    }

    fun withWalkResult(capture: com.fieldwise.gps.GpsCapture) {
        mutableMapState.value = mutableMapState.value.withWalkResult(capture)
    }

    fun acceptPendingCorrection() {
        mutableMapState.value = mutableMapState.value.acceptPendingCorrection(System.currentTimeMillis())
    }

    fun rejectPendingCorrection() {
        mutableMapState.value = mutableMapState.value.rejectPendingCorrection()
    }

    // ---- Zones ----

    fun startZone(kind: ZoneKind = ZoneKind.WATER) {
        mutableMapState.value = mutableMapState.value.startZone(kind)
    }

    fun setZoneKind(kind: ZoneKind) {
        mutableMapState.value = mutableMapState.value.withZoneKind(kind)
    }

    fun finishZone() {
        mutableMapState.value = mutableMapState.value.finishZone(System.currentTimeMillis())
    }

    fun cancelZone() {
        mutableMapState.value = mutableMapState.value.cancelZone()
    }

    fun removeZone(id: String) {
        mutableMapState.value = mutableMapState.value.removeZone(id)
    }

    // ---- Spray configuration ----

    fun updateSprayConfig(config: SprayConfig) {
        mutableMapState.value = mutableMapState.value.withSprayConfig(config)
    }

    fun editSprayParameters() {
        mutableMapState.value = mutableMapState.value.editSprayParameters()
    }

    // ---- Planning ----

    fun generateSprayPath() {
        val state = mutableMapState.value

        // Validate field before planning
        if (state.vertices.isEmpty()) {
            mutableMapState.value = state.withNotice("Trace a field boundary first (at least 3 corners).")
            return
        }
        if (state.field.isEmpty) {
            mutableMapState.value = state.withNotice("Field is too small or invalid. Please check the boundary.")
            return
        }

        val started = state.beginPlanning()
        mutableMapState.value = started
        mutableComparisonPlan.value = null  // Clear comparison when generating new plan

        if (started.sprayState.planning) {
            val inputs = started.planInputs()
            viewModelScope.launch {
                val result = withContext(Dispatchers.Default) {
                    inputs.plan()
                }
                mutableMapState.value = mutableMapState.value.withPlanResult(result, inputs)
                if (result is com.fieldwise.planner.PlanResult.Success) {
                    currentPlan = result.plan
                    mutableMapState.value = mutableMapState.value.withNotice("Path optimized: ${result.plan.sorties.size} flights")
                } else {
                    mutableMapState.value = mutableMapState.value.withNotice("Could not generate a valid path. Check field and obstacles.")
                }
            }
        }
    }

    fun generateStandardComparison() {
        val state = mutableMapState.value
        val plan = state.sprayState.plan ?: return

        // Standard route: same planner but with heading pinned to 0°
        val standardConfig = state.sprayState.config.copy(headingDeg = 0.0)
        val inputs = state.planInputs().copy(config = standardConfig)

        viewModelScope.launch {
            val result = withContext(Dispatchers.Default) {
                inputs.plan()
            }
            if (result is com.fieldwise.planner.PlanResult.Success) {
                mutableComparisonPlan.value = result.plan
            }
        }
    }

    fun clearComparison() {
        mutableComparisonPlan.value = null
    }

    // ---- Search ----

    fun updateSearchQuery(text: String) {
        mutableMapState.value = mutableMapState.value.withSearchQuery(text)
    }

    fun submitSearch() {
        val state = mutableMapState.value
        val submitted = state.submitSearch()
        mutableMapState.value = submitted

        if (submitted.search.searching) {
            val query = submitted.search.query.trim()
            viewModelScope.launch {
                val outcome = withContext(Dispatchers.IO) {
                    // Would call GeocoderPlaceSearch here; for MVP, we skip place name lookup.
                    SearchOutcome.NotFound
                }
                mutableMapState.value = mutableMapState.value.withSearchOutcome(outcome, query)
            }
        }
    }

    fun choosePlace(place: PlaceResult) {
        mutableMapState.value = mutableMapState.value.choosePlace(place)
    }

    fun clearSearch() {
        mutableMapState.value = mutableMapState.value.clearSearch()
    }

    fun goToMyLocation() {
        mutableMapState.value = mutableMapState.value.goToMyLocation()
    }

    // ---- Review and confirmation ----

    fun openReview() {
        mutableMapState.value = mutableMapState.value.openReview()
    }

    fun closeReview() {
        mutableMapState.value = mutableMapState.value.closeReview()
    }

    fun setBoundaryConfirmed(confirmed: Boolean) {
        mutableMapState.value = mutableMapState.value.setBoundaryConfirmed(confirmed, System.currentTimeMillis())
    }

    fun setParametersConfirmed(confirmed: Boolean) {
        mutableMapState.value = mutableMapState.value.setParametersConfirmed(confirmed, System.currentTimeMillis())
    }

    fun confirmMission() {
        mutableMapState.value = mutableMapState.value.confirmMission(System.currentTimeMillis())
    }

    // ---- Export ----

    fun exportMission(format: ExportFormat) {
        val now = System.currentTimeMillis()
        val mission = mutableMapState.value.mission(now) ?: return
        if (!mutableMapState.value.canExport(now)) return

        // This is called from the UI; MainActivity handles the actual share sheet.
        // Record that the export happened.
        mutableMapState.value = mutableMapState.value.recordExport(format, now)
    }

    // ---- Simulation ----

    fun startSimulation() {
        val plan = mutableMapState.value.sprayState.plan
        if (plan == null) {
            mutableMapState.value = mutableMapState.value.withNotice("Generate a spray path first.")
            return
        }
        if (plan.sorties.isEmpty()) {
            mutableMapState.value = mutableMapState.value.withNotice("No valid flight path. Check field and config.")
            return
        }

        val drone = DroneConnection.create(viewModelScope)
        droneConnection = drone

        mutableSimulationState.value = DroneSimulator.init(plan).copy(
            status = com.fieldwise.drone.SimulationStatus.IDLE
        )

        viewModelScope.launch {
            drone.upload(plan)
            drone.start()

            // Wire telemetry to state
            drone.telemetry.collect { state ->
                mutableSimulationState.value = state
            }
        }
    }

    fun pauseSimulation() {
        viewModelScope.launch {
            droneConnection?.pause()
        }
    }

    fun resumeSimulation() {
        viewModelScope.launch {
            droneConnection?.resume()
        }
    }

    fun restartSimulation() {
        viewModelScope.launch {
            droneConnection?.restart()
            mutableSimulationState.value = mutableSimulationState.value.copy(status = com.fieldwise.drone.SimulationStatus.IDLE)
        }
    }

    fun stopSimulation() {
        viewModelScope.launch {
            droneConnection?.stop()
            mutableSimulationState.value = SimulationState(status = com.fieldwise.drone.SimulationStatus.IDLE)
        }
    }

    // ---- Mission history ----

    fun saveMission(name: String) {
        val now = System.currentTimeMillis()
        val mission = mutableMapState.value.mission(now) ?: return
        val record = MissionRecord(name, now, mission)

        val history = mutableMissionHistory.value.toMutableList()
        history.add(0, record) // Newest first
        mutableMissionHistory.value = history

        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                historyStore.saveAll(history)
            }
        }
    }

    fun loadMission(record: MissionRecord) {
        // Restore the mission's field and plan to the MapState for review/re-export
        val mission = record.mission
        // Convert the corrected GeoArea back to vertices (shell of the first/only polygon)
        val vertices = if (mission.corrected.polygons.isNotEmpty()) {
            mission.corrected.polygons.first().shell
        } else {
            emptyList()
        }
        mutableMapState.value = MapState(
            vertices = vertices,
            zones = mission.zones,
            sprayState = com.fieldwise.map.SprayState(
                config = mission.config,
                plan = mission.plan
            )
        )
    }

    fun dismissNotice() {
        mutableMapState.value = mutableMapState.value.withNotice(null)
    }
}
