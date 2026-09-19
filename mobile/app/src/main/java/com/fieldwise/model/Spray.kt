package com.fieldwise.model

/** Weights of the orientation cost: w1 * sprayed distance + w2 * turns + w3 * deadhead distance (metre-equivalents). */
data class CostWeights(
    val flightDistance: Double = 1.0,
    val turn: Double = 6.0,
    val deadhead: Double = 1.0
)

data class SprayConfig(
    val swathWidthM: Double = 4.5,
    val overlapPercent: Double = 15.0,
    val speedMps: Double = 4.0,
    val altitudeM: Double = 3.0,
    // Advanced
    val applicationRateLPerHa: Double = 12.0,
    val tankCapacityL: Double = 10.0,
    val enduranceMin: Double = 20.0,
    val turnPenaltySec: Double = 3.0,
    /** Keep-out margin from the field edge and from no-spray zones, to allow for spray drift. */
    val driftInsetM: Double = 0.5,
    /** Fixed heading in degrees, or null to let the planner choose. */
    val headingDeg: Double? = null,
    val weights: CostWeights = CostWeights()
) {
    /** Effective swath = spray width x (1 - overlap). */
    val spacingM: Double get() = swathWidthM * (1.0 - overlapPercent / 100.0)

    /** Human readable problems; empty when the parameters can be planned with. */
    fun problems(): List<String> = buildList {
        if (swathWidthM <= 0.0) add("Spray width must be greater than 0 m.")
        if (overlapPercent < 0.0 || overlapPercent >= 100.0) add("Overlap must be between 0% and 99%.")
        else if (spacingM <= 0.0) add("Spray width and overlap leave no path spacing.")
        if (speedMps <= 0.0) add("Flight speed must be greater than 0 m/s.")
        if (altitudeM <= 0.0) add("Altitude must be greater than 0 m.")
        if (applicationRateLPerHa < 0.0) add("Application rate cannot be negative.")
        if (tankCapacityL <= 0.0) add("Tank capacity must be greater than 0 L.")
        if (enduranceMin <= 0.0) add("Endurance must be greater than 0 min.")
        if (driftInsetM < 0.0) add("Drift margin cannot be negative.")
    }
}

data class SprayPass(
    val index: Int,
    val start: LatLng,
    val end: LatLng,
    val lengthM: Double,
    val sortie: Int
)

/**
 * The non-spraying leg from the end of pass [fromPass] to the start of pass [toPass].
 * [via] holds the intermediate vertices of a detour around no-spray zones or concave edges.
 * A connector between two flights is never flown ([betweenFlights]).
 */
data class Connector(
    val fromPass: Int,
    val toPass: Int,
    val via: List<LatLng>,
    val lengthM: Double,
    val detour: Boolean,
    val betweenFlights: Boolean
)

data class Sortie(
    val index: Int,
    val passes: List<SprayPass>,
    val sprayDistanceM: Double,
    val transitDistanceM: Double,
    val chemicalL: Double,
    val timeMin: Double
)

data class CandidateResult(
    val angleDeg: Double,
    val passCount: Int,
    val turns: Int,
    val sprayDistanceM: Double,
    val deadheadM: Double,
    val cost: Double,
    val chosen: Boolean
)

data class PlanMetrics(
    val fieldAreaSqm: Double,
    val noSprayAreaSqm: Double,
    val sprayableAreaSqm: Double,
    val coveredAreaSqm: Double,
    val sprayDistanceM: Double,
    val transitDistanceM: Double,
    val turns: Int,
    val passCount: Int,
    val sortieCount: Int,
    val flightTimeMin: Double,
    val chemicalL: Double
) {
    val totalDistanceM: Double get() = sprayDistanceM + transitDistanceM
    val coveragePercent: Double
        get() = if (sprayableAreaSqm > 0.0) (coveredAreaSqm / sprayableAreaSqm * 100.0).coerceIn(0.0, 100.0) else 0.0
}

enum class WaypointAction { SPRAY_ON, SPRAY_OFF, TRANSIT }

data class Waypoint(
    val seq: Int,
    val point: LatLng,
    val altitudeM: Double,
    val action: WaypointAction,
    val pass: Int?,
    val sortie: Int
)

data class SprayPlan(
    val headingDeg: Double,
    val passes: List<SprayPass>,
    /** connectors[i] joins passes[i] to passes[i + 1]. */
    val connectors: List<Connector>,
    val sorties: List<Sortie>,
    val candidates: List<CandidateResult>,
    val metrics: PlanMetrics,
    /** Fingerprint of the boundary, zones and parameters this plan was computed from. */
    val inputsHash: Int,
    val altitudeM: Double,
    val notes: List<String>
) {
    /** Ordered flight points. Transit between two flights is left out; each flight starts at its first pass. */
    fun waypoints(): List<Waypoint> {
        val out = ArrayList<Waypoint>()
        fun add(p: LatLng, action: WaypointAction, pass: Int?, sortie: Int) {
            out.add(Waypoint(out.size, p, altitudeM, action, pass, sortie))
        }
        for (pass in passes) {
            if (pass.index > 0) {
                val c = connectors[pass.index - 1]
                if (!c.betweenFlights) c.via.forEach { add(it, WaypointAction.TRANSIT, null, pass.sortie) }
            }
            add(pass.start, WaypointAction.SPRAY_ON, pass.index, pass.sortie)
            add(pass.end, WaypointAction.SPRAY_OFF, pass.index, pass.sortie)
        }
        return out
    }
}
