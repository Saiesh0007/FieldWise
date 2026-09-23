package com.fieldwise.drone

import com.fieldwise.model.LatLng
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.SprayPlan
import com.fieldwise.model.Waypoint
import com.fieldwise.model.WaypointAction
import kotlin.math.hypot

/** Live state of a simulated drone during a mission: position, progress, battery, spray used. */
data class SimulationState(
    /** Ordinal in [0, 100] representing completion percentage. */
    val progressPercent: Int = 0,
    /** Current position on the route (set to the start of the mission by default). */
    val position: LatLng? = null,
    /** Distance traveled from the start, in metres. */
    val distanceFlownM: Double = 0.0,
    /** Elapsed time from the start of the current segment, in seconds. */
    val elapsedSecondsSinceStart: Double = 0.0,
    /** Volume of chemical sprayed so far, in litres. */
    val sprayUsedL: Double = 0.0,
    /** Battery remaining, as a percentage [0, 100]. Resets to 100% at each sortie boundary. */
    val batteryPercent: Double = 100.0,
    /** The current sortie index (0-based). Used to reset battery at sortie changes. */
    val currentSortie: Int = 0,
    /** Index of the next waypoint to visit. */
    val nextWaypointIndex: Int = 0,
    /** Whether the simulation is running, paused, or completed. */
    val status: SimulationStatus = SimulationStatus.IDLE
) {
    val isFinished: Boolean get() = status == SimulationStatus.COMPLETED
}

enum class SimulationStatus {
    IDLE, RUNNING, PAUSED, COMPLETED
}

/**
 * Pure Kotlin simulator: given a [SprayPlan] and spray config, step the drone's position and state
 * forward by a time delta. No Android dependencies, fully testable.
 *
 * The simulator tracks the drone along waypoints in order, accumulating spray volume only on SPRAY_ON
 * legs and resetting battery to 100% when crossing a sortie boundary (between different tank/battery loads).
 * This ties the simulator to the planner's existing sortie model — no new segmentation logic needed.
 */
object DroneSimulator {
    private const val MIN_PROGRESS_DELTA = 0.01 // At least 0.01% per step to avoid stuck progress bars.

    /**
     * Advances the simulation forward by [deltaSecondsTick] seconds. All calculations run in the local
     * metric frame; the planner's projection is trusted. If the drone reaches the final waypoint,
     * [status] becomes [SimulationStatus.COMPLETED] and subsequent calls are idempotent.
     *
     * @param state Current simulation state
     * @param plan The mission to follow (defines waypoints, sorties, spray segments)
     * @param config Spray configuration (speed, tank capacity, endurance)
     * @param deltaSecondsTick Time delta to advance, in real seconds (or scaled for playback speed)
     * @return Updated state after stepping forward
     */
    fun step(
        state: SimulationState,
        plan: SprayPlan,
        config: SprayConfig,
        deltaSecondsTick: Double
    ): SimulationState {
        if (state.status == SimulationStatus.COMPLETED || state.status == SimulationStatus.IDLE) {
            return state
        }
        if (state.status == SimulationStatus.PAUSED) {
            return state
        }

        val waypoints = plan.waypoints()
        if (waypoints.isEmpty()) {
            return state.copy(status = SimulationStatus.COMPLETED, progressPercent = 100)
        }

        val distancePerSecond = config.speedMps
        val distanceTraveledThisStep = distancePerSecond * deltaSecondsTick

        // Accumulate distance and time
        var accumulatedDistance = state.distanceFlownM + distanceTraveledThisStep
        var accumulatedTime = state.elapsedSecondsSinceStart + deltaSecondsTick
        var nextWaypointIdx = state.nextWaypointIndex
        var currentSortie = state.currentSortie
        var sprayUsed = state.sprayUsedL
        var battery = state.batteryPercent

        // Calculate total distance for progress
        val totalDistance = waypoints.fold(0.0) { acc, wp ->
            val prev = if (wp.seq == 0) waypoints[0].point else waypoints[wp.seq - 1].point
            acc + hypot(wp.point.lat - prev.lat, wp.point.lng - prev.lng)
        }

        // Find position by walking the waypoints
        var currentPos = waypoints.firstOrNull()?.point ?: state.position
        var remainingDist = accumulatedDistance
        var currentWpIdx = 0

        for (i in waypoints.indices) {
            val wp = waypoints[i]
            val nextWp = waypoints.getOrNull(i + 1)
            if (nextWp == null) {
                currentPos = wp.point
                currentWpIdx = i
                break
            }

            val legDist = hypot(nextWp.point.lat - wp.point.lat, nextWp.point.lng - wp.point.lng)
            if (remainingDist <= legDist) {
                // Interpolate position on this leg
                val ratio = remainingDist / legDist
                currentPos = LatLng(
                    wp.point.lat + (nextWp.point.lat - wp.point.lat) * ratio,
                    wp.point.lng + (nextWp.point.lng - wp.point.lng) * ratio
                )
                currentWpIdx = i
                break
            }
            remainingDist -= legDist

            // Check if we cross into the next waypoint; if it's a new sortie, reset battery
            if (nextWp.sortie != wp.sortie) {
                battery = 100.0
                currentSortie = nextWp.sortie
            }

            // Accumulate spray on SPRAY_ON segments
            if (wp.action == WaypointAction.SPRAY_ON && nextWp.action != WaypointAction.SPRAY_OFF) {
                sprayUsed += (legDist / 1000.0) * config.swathWidthM / 10_000.0 * config.applicationRateLPerHa
            }

            currentWpIdx = i
        }

        // Degrade battery based on time and distance
        val timeRatio = accumulatedTime / (config.enduranceMin * 60.0)
        val distRatio = accumulatedDistance / (totalDistance + 1e-9)
        battery = (100.0 - maxOf(timeRatio, distRatio) * 100.0).coerceIn(0.0, 100.0)

        val progress = if (totalDistance > 0) (accumulatedDistance / totalDistance * 100.0).toInt().coerceIn(0, 100) else 100

        return state.copy(
            position = currentPos,
            distanceFlownM = accumulatedDistance,
            elapsedSecondsSinceStart = accumulatedTime,
            sprayUsedL = sprayUsed,
            batteryPercent = battery,
            currentSortie = currentSortie,
            nextWaypointIndex = nextWaypointIdx,
            progressPercent = progress,
            status = if (progress >= 100) SimulationStatus.COMPLETED else SimulationStatus.RUNNING
        )
    }

    /** Initialize a simulation at the start of a plan. */
    fun init(plan: SprayPlan): SimulationState {
        val firstWp = plan.waypoints().firstOrNull()
            ?: return SimulationState(status = SimulationStatus.COMPLETED, progressPercent = 100)
        return SimulationState(
            position = firstWp.point,
            status = SimulationStatus.IDLE,
            currentSortie = firstWp.sortie
        )
    }
}
