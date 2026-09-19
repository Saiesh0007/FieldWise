package com.fieldwise.map

import com.fieldwise.correction.CorrectionKind
import com.fieldwise.correction.GpsTrackConverter
import com.fieldwise.correction.TrackResult
import com.fieldwise.geometry.AreaOps
import com.fieldwise.geometry.BoundaryIssue
import com.fieldwise.gps.GpsCapture
import com.fieldwise.mission.ExportFormat
import com.fieldwise.mission.MissionValidator
import com.fieldwise.mission.problemsOtherThanConfirmations
import com.fieldwise.model.Correction
import com.fieldwise.model.ExportRecord
import com.fieldwise.model.GeoArea
import com.fieldwise.model.GeoPolygon
import com.fieldwise.model.LatLng
import com.fieldwise.model.Mission
import com.fieldwise.model.MissionStatus
import com.fieldwise.model.NoSprayZone
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.ValidationReport
import com.fieldwise.model.ZoneKind
import com.fieldwise.planner.PlanResult
import com.fieldwise.planner.SprayPathPlanner
import java.util.UUID

private fun newFieldId(): String = "FIELD-" + UUID.randomUUID().toString().take(8).uppercase()

/** Everything the planner reads. A finished plan is only applied if these are still what the state holds. */
data class PlanInputs(val field: GeoArea, val zones: List<NoSprayZone>, val config: SprayConfig) {
    fun plan(): PlanResult = SprayPathPlanner.plan(field, zones, config)
}

/** A no-spray zone being drawn: corners are added by tapping the map. */
data class ZoneDraft(val kind: ZoneKind, val corners: List<LatLng> = emptyList())

/** The pilot's explicit sign-offs. Any change to the field, zones or parameters clears all of them. */
data class Confirmations(val boundaryAt: Long? = null, val parametersAt: Long? = null, val missionAt: Long? = null)

/** The part of [MapState] that is saved to disk, so autosave only runs when something worth keeping changed. */
data class PersistKey(
    val fieldId: String,
    val fieldName: String,
    val vertices: List<LatLng>,
    val corrections: List<Correction>,
    val zones: List<NoSprayZone>,
    val config: SprayConfig,
    val layer: MapLayer
)

/**
 * Everything the map screen shows. Pure Kotlin so the whole trace -> correct -> zones -> plan -> validate -> confirm
 * flow can be unit-tested without a device; the Android layer only renders it and forwards taps.
 */
data class MapState(
    val fieldId: String = newFieldId(),
    val fieldName: String = "Field",
    /** The corners tapped by the user, in order. */
    val vertices: List<LatLng> = emptyList(),
    val zoomLevel: Double = 16.0,
    val layer: MapLayer = MapLayer.SATELLITE,
    val gpsState: GpsState = GpsState(),
    val boundaryState: BoundaryState = BoundaryState(),
    val sprayState: SprayState = SprayState(),
    val zones: List<NoSprayZone> = emptyList(),
    val zoneDraft: ZoneDraft? = null,
    val confirmations: Confirmations = Confirmations(),
    val exports: List<ExportRecord> = emptyList(),
    val reviewOpen: Boolean = false,
    /** A message for the user, shown until dismissed. */
    val notice: String? = null
) {
    /** The boundary the planner and the GPS correction work on: the traced polygon plus accepted corrections. */
    val field: GeoArea get() = boundaryState.corrected

    val hasCorrections: Boolean get() = boundaryState.canUndo

    private val boundaryLocked: Boolean get() = hasCorrections || boundaryState.pendingCorrection != null

    fun boundaryIssues(): List<BoundaryIssue> = if (field.isEmpty) emptyList() else AreaOps.validate(field)

    fun planInputs() = PlanInputs(field, zones, sprayState.config)

    fun persistKey() = PersistKey(
        fieldId, fieldName, vertices, boundaryState.history.applied, zones, sprayState.config, layer
    )

    /** Drops the plan and every confirmation: whatever they covered has changed. */
    private fun invalidated(): MapState = copy(
        sprayState = sprayState.copy(plan = null, error = null),
        confirmations = Confirmations(),
        exports = emptyList(),
        reviewOpen = false
    )

    // ---- tracing ----

    /**
     * Adds a corner to the zone being drawn, or to the field. Field corners are ignored once a GPS correction exists
     * or is pending, so tapping can never silently discard it.
     */
    fun withVertex(p: LatLng): MapState = when {
        zoneDraft != null -> copy(zoneDraft = zoneDraft.copy(corners = zoneDraft.corners + p))
        boundaryLocked -> this
        else -> retrace(vertices + p)
    }

    fun withoutLastVertex(): MapState = if (boundaryLocked || vertices.isEmpty()) this else retrace(vertices.dropLast(1))

    /** Undoes the last zone corner, else the last GPS correction, else the last traced corner. */
    fun undo(): MapState = when {
        zoneDraft != null ->
            if (zoneDraft.corners.isEmpty()) copy(zoneDraft = null)
            else copy(zoneDraft = zoneDraft.copy(corners = zoneDraft.corners.dropLast(1)))
        hasCorrections -> withBoundaryState(boundaryState.undo())
        else -> withoutLastVertex()
    }

    fun cleared(): MapState = copy(
        fieldId = newFieldId(),
        vertices = emptyList(),
        boundaryState = BoundaryState(),
        sprayState = sprayState.copy(plan = null, planning = false, error = null),
        zones = emptyList(),
        zoneDraft = null,
        confirmations = Confirmations(),
        exports = emptyList(),
        reviewOpen = false,
        notice = null
    )

    private fun retrace(v: List<LatLng>): MapState {
        val traced = if (v.size < 3) GeoArea.EMPTY else GeoArea.of(GeoPolygon(v))
        return invalidated().copy(vertices = v, boundaryState = BoundaryState().load(traced), notice = null)
    }

    // ---- no-spray zones ----

    fun startZone(kind: ZoneKind = ZoneKind.WATER): MapState = when {
        field.isEmpty -> copy(notice = "Draw the field boundary before adding a no-spray zone.")
        boundaryState.pendingCorrection != null || gpsState.isWalking -> this
        else -> copy(zoneDraft = ZoneDraft(kind), notice = null)
    }

    fun withZoneKind(kind: ZoneKind): MapState = zoneDraft?.let { copy(zoneDraft = it.copy(kind = kind)) } ?: this

    fun cancelZone(): MapState = copy(zoneDraft = null)

    /** Validates the drawn zone and adds it, or explains why it cannot be used. */
    fun finishZone(nowMs: Long): MapState {
        val draft = zoneDraft ?: return this
        if (draft.corners.size < 3) return copy(notice = "A zone needs at least 3 corners.")
        val polygon = GeoPolygon(draft.corners)
        AreaOps.validate(polygon).firstOrNull()?.let { return copy(notice = "That zone cannot be used: ${it.message}") }
        val overlapSqm = AreaOps.areaSqm(field) - AreaOps.areaSqm(AreaOps.difference(field, polygon))
        if (overlapSqm < AreaOps.MIN_AREA_SQM) {
            return copy(notice = "That zone is outside the field, so it would have no effect. Draw it over the field.")
        }
        val number = (zones.filter { it.kind == draft.kind }
            .mapNotNull { it.name.substringAfterLast(' ').toIntOrNull() }.maxOrNull() ?: 0) + 1
        val zone = NoSprayZone(
            id = "zone_${nowMs}_${zones.size}",
            name = "${draft.kind.label} $number",
            kind = draft.kind,
            polygon = polygon,
            createdAt = nowMs
        )
        return invalidated().copy(zones = zones + zone, zoneDraft = null, notice = null)
    }

    fun removeZone(id: String): MapState =
        if (zones.none { it.id == id }) this else invalidated().copy(zones = zones.filterNot { it.id == id })

    // ---- GPS correction ----

    fun withGpsState(state: GpsState): MapState = copy(gpsState = state)

    /** Turns a finished walk into a pending correction to review, or a notice explaining why it cannot be used. */
    fun withWalkResult(capture: GpsCapture): MapState = when (val result = GpsTrackConverter.convert(capture, field)) {
        is TrackResult.Ok -> {
            val c = result.correction
            copy(
                boundaryState = boundaryState.setPendingCorrection(
                    CorrectionPreview(
                        correction = c,
                        kind = c.suggestedKind.name,
                        method = c.method.label,
                        area = c.polygonAreaSqm,
                        warnings = c.warnings
                    )
                ),
                notice = null
            )
        }
        is TrackResult.Failed -> copy(notice = result.reason)
    }

    fun acceptPendingCorrection(nowMs: Long): MapState {
        val c = boundaryState.pendingCorrection?.correction ?: return this
        val id = "gps_$nowMs"
        val correction = when (c.suggestedKind) {
            CorrectionKind.ADD -> Correction.AddArea(id, nowMs, c.polygon, c.stats)
            CorrectionKind.REMOVE -> Correction.RemoveArea(id, nowMs, c.polygon, c.stats)
        }
        return withBoundaryState(boundaryState.applyCorrection(correction))
    }

    fun rejectPendingCorrection(): MapState = copy(boundaryState = boundaryState.setPendingCorrection(null))

    /** Adopts [state], dropping the plan and confirmations if the boundary changed and surfacing a refused correction. */
    fun withBoundaryState(state: BoundaryState): MapState {
        val changed = state.corrected != boundaryState.corrected
        val base = if (changed) invalidated() else this
        return base.copy(
            boundaryState = state.copy(rejection = null),
            notice = state.rejection?.let { "That GPS correction could not be applied: $it" } ?: base.notice
        )
    }

    // ---- spray planning ----

    fun withSprayConfig(config: SprayConfig): MapState =
        invalidated().copy(sprayState = sprayState.copy(config = config, plan = null, error = null))

    fun editSprayParameters(): MapState = invalidated()

    /** Marks planning as started, or records why it cannot start. Check [SprayState.planning] on the result. */
    fun beginPlanning(): MapState = when {
        sprayState.planning -> this
        field.isEmpty -> copy(
            sprayState = sprayState.copy(error = "Draw the field boundary first: tap at least 3 corners on the map.")
        )
        else -> copy(sprayState = sprayState.copy(planning = true, error = null))
    }

    /** Applies a finished plan, unless the field, zones or parameters changed while it was being computed. */
    fun withPlanResult(result: PlanResult, inputs: PlanInputs): MapState {
        if (inputs != planInputs()) return copy(sprayState = sprayState.copy(planning = false))
        return when (result) {
            is PlanResult.Success -> copy(sprayState = sprayState.copy(plan = result.plan, planning = false, error = null))
            is PlanResult.Failure -> copy(sprayState = sprayState.copy(plan = null, planning = false, error = result.message))
        }
    }

    // ---- validation, confirmation and export ----

    /** The pre-flight report for the current plan, or null when there is no plan yet. */
    fun validation(nowMs: Long): ValidationReport? {
        val plan = sprayState.plan ?: return null
        return MissionValidator.validate(
            field = field,
            zones = zones,
            config = sprayState.config,
            plan = plan,
            corrections = boundaryState.history.applied,
            boundaryConfirmedAt = confirmations.boundaryAt,
            parametersConfirmedAt = confirmations.parametersAt,
            nowMs = nowMs
        )
    }

    fun openReview(): MapState = if (sprayState.plan != null) copy(reviewOpen = true) else this

    fun closeReview(): MapState = copy(reviewOpen = false)

    fun setBoundaryConfirmed(confirmed: Boolean, nowMs: Long): MapState =
        copy(confirmations = confirmations.copy(boundaryAt = if (confirmed) nowMs else null, missionAt = null))

    fun setParametersConfirmed(confirmed: Boolean, nowMs: Long): MapState =
        copy(confirmations = confirmations.copy(parametersAt = if (confirmed) nowMs else null, missionAt = null))

    /** The final sign-off. Needs both earlier confirmations and a report with nothing failed. */
    fun confirmMission(nowMs: Long): MapState {
        val report = validation(nowMs) ?: return this
        if (confirmations.boundaryAt == null || confirmations.parametersAt == null) return this
        if (report.problemsOtherThanConfirmations().isNotEmpty()) {
            return copy(notice = "Fix the failed checks before confirming the mission.")
        }
        return copy(confirmations = confirmations.copy(missionAt = nowMs))
    }

    fun canExport(nowMs: Long): Boolean = confirmations.missionAt != null && validation(nowMs)?.canExport == true

    /** A self-contained snapshot of the mission as it stands, or null without a plan. */
    fun mission(nowMs: Long): Mission? {
        val plan = sprayState.plan ?: return null
        val report = validation(nowMs) ?: return null
        val confirmed = confirmations.missionAt != null && report.canExport
        val status = when {
            confirmed -> MissionStatus.CONFIRMED
            report.problemsOtherThanConfirmations().isEmpty() -> MissionStatus.VALIDATED
            else -> MissionStatus.DRAFT
        }
        return Mission(
            id = "$fieldId-${confirmations.missionAt ?: nowMs}",
            fieldId = fieldId,
            fieldName = fieldName,
            createdAt = nowMs,
            status = status,
            confirmedAt = if (confirmed) confirmations.missionAt else null,
            config = sprayState.config,
            original = boundaryState.history.original,
            corrected = field,
            zones = zones,
            corrections = boundaryState.history.applied,
            plan = plan,
            report = report,
            exports = exports
        )
    }

    fun recordExport(format: ExportFormat, nowMs: Long): MapState =
        copy(exports = exports + ExportRecord(format.label, nowMs))

    fun withLayer(layer: MapLayer): MapState = copy(layer = layer)

    fun withNotice(text: String?): MapState = copy(notice = text)
}

enum class MapLayer(val label: String, val attribution: String) {
    SATELLITE("Satellite", "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community"),
    STREET("Street", "© OpenStreetMap contributors"),
    TOPO("Topographic", "Map © Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community")
}
