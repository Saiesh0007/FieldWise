package com.fieldwise.gps

import com.fieldwise.geo.GeoMath
import com.fieldwise.model.LatLng
import kotlin.math.roundToInt

/** Thresholds for how much a phone's GPS fix can be trusted. The values are receiver-reported 68% radii. */
object GpsPolicy {
    const val GOOD_M = 5.0
    const val FAIR_M = 10.0

    /** Fixes worse than this are not recorded at all. */
    const val DROP_M = 15.0

    const val DISCLAIMER =
        "Phone GPS is typically accurate to a few metres, not survey grade. Check the result on the map."

    enum class Rating { GOOD, FAIR, POOR }

    fun rating(accuracyM: Double): Rating = when {
        accuracyM <= GOOD_M -> Rating.GOOD
        accuracyM <= FAIR_M -> Rating.FAIR
        else -> Rating.POOR
    }

    /** A warning to show next to the live accuracy, or null when the signal is fine. */
    fun advice(accuracyM: Double?): String? = when {
        accuracyM == null -> "Waiting for a GPS fix. Move to an open area."
        accuracyM > DROP_M ->
            "GPS accuracy is currently ±${accuracyM.roundToInt()} m. Move to an open area before capturing the boundary."
        accuracyM > FAIR_M ->
            "GPS accuracy is only ±${accuracyM.roundToInt()} m. The captured line will be rough."
        else -> null
    }
}

data class GpsFix(val point: LatLng, val accuracyM: Double, val timeMs: Long)

data class GpsCapture(
    val fixes: List<GpsFix>,
    val droppedFixes: Int,
    val startedAt: Long,
    val endedAt: Long
)

enum class FixOutcome { ACCEPTED, DROPPED_POOR_ACCURACY, IGNORED }

/**
 * State machine of one GPS walk: start, pause, resume, finish. Pure Kotlin, so it can be tested without a device;
 * the Android location listener just feeds it fixes.
 */
class GpsWalkSession(
    private val maxAccuracyM: Double = GpsPolicy.DROP_M,
    /** Fixes closer than this to the last recorded one are standing-still noise. */
    private val minStepM: Double = 0.5
) {
    enum class State { IDLE, RECORDING, PAUSED, FINISHED }

    var state: State = State.IDLE
        private set
    var droppedFixes: Int = 0
        private set
    var lengthMeters: Double = 0.0
        private set
    var lastAccuracyM: Double? = null
        private set

    private val accepted = ArrayList<GpsFix>()
    private var startedAt = 0L
    private var endedAt = 0L

    val fixCount: Int get() = accepted.size
    val points: List<LatLng> get() = accepted.map { it.point }

    fun start(nowMs: Long) {
        check(state == State.IDLE) { "A walk can only be started once" }
        startedAt = nowMs
        state = State.RECORDING
    }

    fun pause() {
        if (state == State.RECORDING) state = State.PAUSED
    }

    fun resume() {
        if (state == State.PAUSED) state = State.RECORDING
    }

    fun onFix(fix: GpsFix): FixOutcome {
        if (state != State.RECORDING) return FixOutcome.IGNORED
        lastAccuracyM = fix.accuracyM
        if (fix.accuracyM > maxAccuracyM) {
            droppedFixes++
            return FixOutcome.DROPPED_POOR_ACCURACY
        }
        val previous = accepted.lastOrNull()
        if (previous != null) {
            val step = GeoMath.distanceM(previous.point, fix.point)
            if (step < minStepM) return FixOutcome.IGNORED
            lengthMeters += step
        }
        accepted.add(fix)
        return FixOutcome.ACCEPTED
    }

    fun finish(nowMs: Long): GpsCapture {
        check(state == State.RECORDING || state == State.PAUSED) { "No walk in progress" }
        endedAt = nowMs
        state = State.FINISHED
        return GpsCapture(accepted.toList(), droppedFixes, startedAt, endedAt)
    }
}
