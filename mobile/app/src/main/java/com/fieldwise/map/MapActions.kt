package com.fieldwise.map

import com.fieldwise.mission.ExportFormat
import com.fieldwise.model.LatLng
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.ZoneKind

/** Everything the screen can ask for. The screen renders [MapState]; the activity decides what each action does. */
data class MapActions(
    val onAddVertex: (LatLng) -> Unit,
    val onUndo: () -> Unit,
    val onReset: () -> Unit,
    val onLayerChange: (MapLayer) -> Unit,
    val onGpsStart: () -> Unit,
    val onGpsPause: () -> Unit,
    val onGpsResume: () -> Unit,
    val onGpsFinish: () -> Unit,
    val onGpsCancel: () -> Unit,
    val onCorrectionAccept: () -> Unit,
    val onCorrectionReject: () -> Unit,
    val onSprayConfigChange: (SprayConfig) -> Unit,
    val onGenerateSprayPlan: () -> Unit,
    val onEditSprayParameters: () -> Unit,
    val onStartZone: () -> Unit,
    val onZoneKind: (ZoneKind) -> Unit,
    val onFinishZone: () -> Unit,
    val onCancelZone: () -> Unit,
    val onRemoveZone: (String) -> Unit,
    val onOpenReview: () -> Unit,
    val onCloseReview: () -> Unit,
    val onConfirmBoundary: (Boolean) -> Unit,
    val onConfirmParameters: (Boolean) -> Unit,
    val onConfirmMission: () -> Unit,
    val onExport: (ExportFormat) -> Unit,
    val onDismissNotice: () -> Unit
)
