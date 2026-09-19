package com.fieldwise.model

enum class CheckStatus { PASS, WARN, FAIL }

enum class CheckId {
    BOUNDARY_VALID,
    ZONES_VALID,
    PLAN_CURRENT,
    PARAMETERS_VALID,
    PATH_INSIDE_FIELD,
    PATH_AVOIDS_ZONES,
    START_END_VALID,
    COVERAGE,
    FLIGHTS,
    GPS_ACCURACY,
    BOUNDARY_CONFIRMED,
    PARAMETERS_CONFIRMED
}

data class Check(val id: CheckId, val label: String, val status: CheckStatus, val detail: String? = null)

data class ValidationReport(val checks: List<Check>, val generatedAt: Long) {
    val failures: List<Check> get() = checks.filter { it.status == CheckStatus.FAIL }
    val warnings: List<Check> get() = checks.filter { it.status == CheckStatus.WARN }

    /** A mission is exportable only when nothing failed. Warnings are shown but do not block. */
    val canExport: Boolean get() = failures.isEmpty()
}

/** Not "ready" merely because a route exists: it must be validated and then confirmed by the pilot. */
enum class MissionStatus(val label: String) {
    DRAFT("Draft"),
    VALIDATED("Validated"),
    CONFIRMED("Confirmed by pilot")
}

data class ExportRecord(val format: String, val at: Long)

/** Self-contained snapshot, so a saved mission does not change when its field is edited later. */
data class Mission(
    val id: String,
    val fieldId: String,
    val fieldName: String,
    val createdAt: Long,
    val status: MissionStatus,
    val confirmedAt: Long?,
    val config: SprayConfig,
    val original: GeoArea,
    val corrected: GeoArea,
    val zones: List<NoSprayZone>,
    val corrections: List<Correction>,
    val plan: SprayPlan,
    val report: ValidationReport,
    val exports: List<ExportRecord> = emptyList()
)
