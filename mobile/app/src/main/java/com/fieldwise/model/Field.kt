package com.fieldwise.model

enum class FieldOrigin(val label: String) {
    TRACED_ON_SATELLITE("Traced on satellite image"),
    GPS_WALK("Walked with GPS"),
    IMPORTED_GEOJSON("Imported GeoJSON"),
    IMPORTED_KML("Imported KML"),
    SAMPLE("Sample field")
}

/** Where the background imagery came from. [date] stays null when the provider does not say. */
data class ImageryInfo(val provider: String, val date: String? = null)

enum class ZoneKind(val label: String) {
    WATER("Water"),
    BUILDING("Building"),
    ROAD("Road"),
    LIVESTOCK("Livestock"),
    TREATED("Previously treated"),
    OBSTACLE("Obstacle"),
    OTHER("Other")
}

data class NoSprayZone(
    val id: String,
    val name: String,
    val kind: ZoneKind,
    val polygon: GeoPolygon,
    val createdAt: Long
)

/** Quality summary of a GPS walk. Accuracy is the receiver's own 68% radius estimate, not survey grade. */
data class GpsStats(
    val fixCount: Int,
    val droppedFixes: Int,
    val lengthMeters: Double,
    val meanAccuracyM: Double,
    val worstAccuracyM: Double,
    val startedAt: Long,
    val endedAt: Long
)

/** One accepted change to the boundary. The original boundary is never modified; corrections are replayed on top of it. */
sealed interface Correction {
    val id: String
    val createdAt: Long
    val gps: GpsStats?

    data class AddArea(
        override val id: String,
        override val createdAt: Long,
        val polygon: GeoPolygon,
        override val gps: GpsStats? = null
    ) : Correction

    data class RemoveArea(
        override val id: String,
        override val createdAt: Long,
        val polygon: GeoPolygon,
        override val gps: GpsStats? = null
    ) : Correction

    data class MoveVertex(
        override val id: String,
        override val createdAt: Long,
        val from: LatLng,
        val to: LatLng
    ) : Correction {
        override val gps: GpsStats? get() = null
    }
}

data class Field(
    val id: String,
    val name: String,
    val createdAt: Long,
    val updatedAt: Long,
    val origin: FieldOrigin,
    val imagery: ImageryInfo?,
    /** The boundary as first captured. Never overwritten. */
    val original: GeoArea,
    val corrections: List<Correction> = emptyList(),
    val noSprayZones: List<NoSprayZone> = emptyList(),
    /** Set when the pilot explicitly confirms the corrected boundary; cleared by any later change to it. */
    val boundaryConfirmedAt: Long? = null,
    val sprayConfig: SprayConfig = SprayConfig(),
    val configConfirmedAt: Long? = null
) {
    val hasGpsCorrection: Boolean get() = corrections.any { it.gps != null }

    val boundaryStatus: BoundaryStatus
        get() = when {
            boundaryConfirmedAt != null -> BoundaryStatus.CONFIRMED
            corrections.isNotEmpty() -> BoundaryStatus.CORRECTED
            else -> BoundaryStatus.UNVERIFIED
        }
}

enum class BoundaryStatus(val label: String) {
    UNVERIFIED("Satellite boundary - not verified in the field"),
    CORRECTED("Corrected - awaiting confirmation"),
    CONFIRMED("Confirmed by pilot")
}
