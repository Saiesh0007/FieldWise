package com.fieldwise.map

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fieldwise.geometry.AreaOps

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapScreen(state: MapState, actions: MapActions) {
    Box(modifier = Modifier.fillMaxSize()) {
        FieldMap(state = state, onTap = actions.onAddVertex, modifier = Modifier.fillMaxSize())

        Column(
            modifier = Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.7f))
                .statusBarsPadding()
                .padding(8.dp)
        ) {
            PlaceSearchBar(
                search = state.search,
                onQuery = actions.onSearchQuery,
                onSubmit = actions.onSearchSubmit,
                onPick = actions.onSearchPick,
                onClear = actions.onSearchClear,
                onMyLocation = actions.onGoToMyLocation,
                modifier = Modifier.padding(bottom = 6.dp)
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                MapLayer.values().forEach { layer ->
                    FilterChip(
                        selected = state.layer == layer,
                        onClick = { actions.onLayerChange(layer) },
                        label = { Text(layer.label) },
                        colors = FilterChipDefaults.filterChipColors(
                            labelColor = Color.White,
                            selectedContainerColor = Color.White,
                            selectedLabelColor = Color.Black
                        )
                    )
                }
            }
            Text(
                state.layer.attribution,
                color = Color.LightGray,
                fontSize = 10.sp,
                modifier = Modifier.padding(top = 4.dp)
            )
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
        ) {
            state.notice?.let { NoticeBanner(it, actions.onDismissNotice) }

            val pending = state.boundaryState.pendingCorrection
            val draft = state.zoneDraft
            val plan = state.sprayState.plan
            val panelHeight = Modifier.heightIn(max = 300.dp)
            when {
                pending != null -> CorrectionPreviewCard(
                    preview = pending,
                    onAccept = actions.onCorrectionAccept,
                    onReject = actions.onCorrectionReject,
                    modifier = panelHeight
                )
                state.gpsState.isWalking -> GpsWalkControls(
                    isPaused = state.gpsState.isPaused,
                    accuracy = state.gpsState.currentAccuracy,
                    trackPointCount = state.gpsState.trackedPoints.size,
                    trackLength = state.gpsState.walkSession.lengthMeters,
                    onPause = actions.onGpsPause,
                    onResume = actions.onGpsResume,
                    onFinish = actions.onGpsFinish,
                    onCancel = actions.onGpsCancel
                )
                draft != null -> ZoneDraftPanel(
                    draft = draft,
                    onKind = actions.onZoneKind,
                    onFinish = actions.onFinishZone,
                    onCancel = actions.onCancelZone
                )
                !state.field.isEmpty && plan == null -> SprayConfigControls(
                    config = state.sprayState.config,
                    zones = state.zones,
                    error = state.sprayState.error,
                    planning = state.sprayState.planning,
                    onConfigChange = actions.onSprayConfigChange,
                    onGeneratePlan = actions.onGenerateSprayPlan,
                    onAddZone = actions.onStartZone,
                    onRemoveZone = actions.onRemoveZone,
                    modifier = panelHeight
                )
                plan != null -> PlanMetricsCard(
                    plan = plan,
                    onEdit = actions.onEditSprayParameters,
                    onReview = actions.onOpenReview,
                    modifier = panelHeight
                )
            }

            BottomBar(state = state, actions = actions)
        }

        if (state.reviewOpen) ReviewScreen(state = state, actions = actions)
    }
}

@Composable
private fun NoticeBanner(text: String, onDismiss: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3E0))
    ) {
        Row(
            modifier = Modifier.padding(start = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodySmall,
                color = Color.Black
            )
            TextButton(onClick = onDismiss) { Text("OK") }
        }
    }
}

/** Disabled buttons stay visible on the dark bar instead of vanishing into it. */
@Composable
private fun barButtonColors(container: Color) = ButtonDefaults.buttonColors(
    containerColor = container,
    disabledContainerColor = container.copy(alpha = 0.35f),
    disabledContentColor = Color.White.copy(alpha = 0.6f)
)

@Composable
private fun BottomBar(state: MapState, actions: MapActions) {
    var confirmReset by remember { mutableStateOf(false) }
    val areaSqm = remember(state.field) { if (state.field.isEmpty) 0.0 else AreaOps.areaSqm(state.field) }
    val issues = remember(state.field) { state.boundaryIssues() }

    val status = when {
        state.zoneDraft != null -> "Tap the corners of the no-spray zone (${state.zoneDraft.corners.size} so far), then Finish."
        state.gpsState.isWalking -> "Walk along the field edge, then tap Finish."
        state.field.isEmpty && state.vertices.isEmpty() ->
            "Tap the map to trace the field corners, or walk its edge with GPS."
        state.field.isEmpty -> "${state.vertices.size} of 3 corners. Keep tapping the map."
        issues.isNotEmpty() -> "⚠ ${issues.first().message}"
        else -> "%.2f ha · %d corners%s%s".format(
            areaSqm / 10_000.0,
            state.field.vertexCount,
            if (state.hasCorrections) " · GPS-corrected" else "",
            if (state.zones.isNotEmpty()) " · ${state.zones.size} no-spray zone(s)" else ""
        )
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color.Black.copy(alpha = 0.75f))
            .navigationBarsPadding()
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Text(status, color = Color.White, style = MaterialTheme.typography.bodySmall)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(
                onClick = actions.onGpsStart,
                enabled = !state.gpsState.isWalking && state.zoneDraft == null && state.boundaryState.pendingCorrection == null,
                modifier = Modifier.weight(1.5f),
                colors = barButtonColors(Color(0xFF1976D2))
            ) { Text("Walk with GPS") }
            Button(
                onClick = actions.onUndo,
                enabled = state.vertices.isNotEmpty() || state.hasCorrections || state.zoneDraft != null,
                modifier = Modifier.weight(1f),
                colors = barButtonColors(Color.Gray)
            ) { Text("Undo") }
            Button(
                onClick = { if (state.field.isEmpty && state.vertices.isEmpty()) actions.onReset() else confirmReset = true },
                modifier = Modifier.weight(1f),
                colors = barButtonColors(Color(0xFFD32F2F))
            ) { Text("Reset") }
        }
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Clear the field?") },
            text = { Text("The boundary, GPS corrections, no-spray zones and spray path will be removed.") },
            confirmButton = {
                TextButton(onClick = { confirmReset = false; actions.onReset() }) { Text("Clear") }
            },
            dismissButton = {
                TextButton(onClick = { confirmReset = false }) { Text("Keep") }
            }
        )
    }
}
