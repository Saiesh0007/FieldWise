package com.fieldwise.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fieldwise.map.GpsController
import com.fieldwise.map.MapActions
import com.fieldwise.map.MapScreen
import com.fieldwise.map.MapState
import com.fieldwise.model.ZoneKind
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

class MainActivity : ComponentActivity() {
    private lateinit var gpsController: GpsController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        gpsController = GpsController(applicationContext)
        setContent { FieldWiseRoot(gpsController) }
    }

    override fun onDestroy() {
        super.onDestroy()
        gpsController.stopAllTracking()
    }
}

private val LOCATION_PERMISSIONS = arrayOf(
    Manifest.permission.ACCESS_FINE_LOCATION,
    Manifest.permission.ACCESS_COARSE_LOCATION
)

@OptIn(FlowPreview::class)
@Composable
private fun FieldWiseRoot(gpsController: GpsController) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val store = remember { FieldStore(context.applicationContext) }
    // The saved field comes back on launch, so a closed or killed app loses nothing.
    var mapState by remember { mutableStateOf(store.load() ?: MapState()) }
    val gpsState by gpsController.gpsState.collectAsStateWithLifecycle()

    LaunchedEffect(gpsState) { mapState = mapState.withGpsState(gpsState) }

    LaunchedEffect(store) {
        snapshotFlow { mapState }
            .distinctUntilChangedBy { it.persistKey() }
            .debounce(500)
            .collect { latest -> withContext(Dispatchers.IO) { store.save(latest) } }
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            gpsController.getLastKnownLocation()
        } else {
            mapState = mapState.withNotice(
                "Precise location is needed to show your position and walk field boundaries. " +
                    "You can still trace the field by tapping the map."
            )
        }
    }

    LaunchedEffect(Unit) {
        if (gpsController.hasLocationPermission()) gpsController.getLastKnownLocation()
        else permissionLauncher.launch(LOCATION_PERMISSIONS)
    }

    val actions = MapActions(
        onAddVertex = { mapState = mapState.withVertex(it) },
        onUndo = { mapState = mapState.undo() },
        onReset = {
            gpsController.stopAllTracking()
            mapState = mapState.cleared()
        },
        onLayerChange = { mapState = mapState.withLayer(it) },
        onGpsStart = {
            if (!gpsController.hasLocationPermission()) {
                permissionLauncher.launch(LOCATION_PERMISSIONS)
            } else if (!gpsController.startTracking()) {
                mapState = mapState.withNotice("The GPS walk could not be started. Check that location is turned on.")
            }
        },
        onGpsPause = { gpsController.pauseTracking() },
        onGpsResume = { gpsController.resumeTracking() },
        onGpsCancel = { gpsController.stopAllTracking() },
        onGpsFinish = {
            val capture = gpsController.finishTracking()
            if (capture != null) mapState = mapState.withWalkResult(capture)
            // A usable walk stays on the map until it is accepted or rejected; an unusable one is discarded now.
            if (mapState.boundaryState.pendingCorrection == null) gpsController.stopAllTracking()
        },
        onCorrectionAccept = {
            mapState = mapState.acceptPendingCorrection(System.currentTimeMillis())
            gpsController.stopAllTracking()
        },
        onCorrectionReject = {
            mapState = mapState.rejectPendingCorrection()
            gpsController.stopAllTracking()
        },
        onSprayConfigChange = { mapState = mapState.withSprayConfig(it) },
        onEditSprayParameters = { mapState = mapState.editSprayParameters() },
        onGenerateSprayPlan = {
            val before = mapState
            val started = before.beginPlanning()
            mapState = started
            if (started.sprayState.planning && !before.sprayState.planning) {
                val inputs = started.planInputs()
                scope.launch {
                    val result = withContext(Dispatchers.Default) { inputs.plan() }
                    mapState = mapState.withPlanResult(result, inputs)
                }
            }
        },
        onStartZone = { mapState = mapState.startZone(ZoneKind.WATER) },
        onZoneKind = { mapState = mapState.withZoneKind(it) },
        onFinishZone = { mapState = mapState.finishZone(System.currentTimeMillis()) },
        onCancelZone = { mapState = mapState.cancelZone() },
        onRemoveZone = { mapState = mapState.removeZone(it) },
        onOpenReview = { mapState = mapState.openReview() },
        onCloseReview = { mapState = mapState.closeReview() },
        onConfirmBoundary = { mapState = mapState.setBoundaryConfirmed(it, System.currentTimeMillis()) },
        onConfirmParameters = { mapState = mapState.setParametersConfirmed(it, System.currentTimeMillis()) },
        onConfirmMission = { mapState = mapState.confirmMission(System.currentTimeMillis()) },
        onExport = { format ->
            val now = System.currentTimeMillis()
            val mission = mapState.mission(now)
            if (mission == null || !mapState.canExport(now)) {
                mapState = mapState.withNotice("Confirm the mission before exporting it.")
            } else {
                try {
                    MissionSharing.share(context, mission, format)
                    mapState = mapState.recordExport(format, now)
                } catch (e: ActivityNotFoundException) {
                    mapState = mapState.withNotice("No app on this phone can receive a ${format.label} file.")
                } catch (e: IOException) {
                    mapState = mapState.withNotice("The ${format.label} file could not be written. Is the phone storage full?")
                } catch (e: IllegalStateException) {
                    mapState = mapState.withNotice(e.message ?: "The mission cannot be exported.")
                }
            }
        },
        onDismissNotice = { mapState = mapState.withNotice(null) }
    )

    MapScreen(state = mapState, actions = actions)
}
