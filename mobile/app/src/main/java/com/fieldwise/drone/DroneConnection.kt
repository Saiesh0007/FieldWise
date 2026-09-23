package com.fieldwise.drone

import com.fieldwise.model.SprayConfig
import com.fieldwise.model.SprayPlan
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Interface for drone connection and telemetry control.
 */
interface DroneConnection {
    val telemetry: StateFlow<SimulationState>

    suspend fun upload(plan: SprayPlan)
    suspend fun start()
    suspend fun pause()
    suspend fun resume()
    suspend fun restart()
    suspend fun stop()

    companion object {
        fun create(scope: CoroutineScope): DroneConnection = MockDrone(scope)
    }
}

/**
 * Mock drone implementation for local simulation and playback.
 */
class MockDrone(private val scope: CoroutineScope) : DroneConnection {
    private val mutableTelemetry = MutableStateFlow(SimulationState())
    override val telemetry: StateFlow<SimulationState> = mutableTelemetry

    private var currentPlan: SprayPlan? = null
    private var currentConfig: SprayConfig? = null
    private var tickingJob: kotlinx.coroutines.Job? = null

    /** Playback speed multiplier: e.g. 4.0 runs the mission 4x faster. */
    private var playbackSpeedX = 4.0

    override suspend fun upload(plan: SprayPlan) {
        currentPlan = plan
        // For a real system, this would serialize and send waypoints to the hardware.
        // For the mock, we just prepare the telemetry.
        mutableTelemetry.value = DroneSimulator.init(plan)
    }

    override suspend fun start() {
        val plan = currentPlan ?: return
        mutableTelemetry.value = DroneSimulator.init(plan).copy(status = SimulationStatus.RUNNING)

        tickingJob?.cancel()
        tickingJob = scope.launch {
            val frameIntervalMs = 33 // ~30 fps
            val scaledDeltaSec = frameIntervalMs / 1000.0 * playbackSpeedX

            while (true) {
                delay(frameIntervalMs.toLong())
                val current = mutableTelemetry.value
                if (current.status == SimulationStatus.COMPLETED) break
                if (current.status != SimulationStatus.RUNNING) continue

                val next = DroneSimulator.step(current, plan, SprayConfig(), scaledDeltaSec)
                mutableTelemetry.value = next
                if (next.status == SimulationStatus.COMPLETED) break
            }
        }
    }

    override suspend fun pause() {
        if (mutableTelemetry.value.status == SimulationStatus.RUNNING) {
            mutableTelemetry.value = mutableTelemetry.value.copy(status = SimulationStatus.PAUSED)
            tickingJob?.cancel()
        }
    }

    override suspend fun resume() {
        if (mutableTelemetry.value.status == SimulationStatus.PAUSED) {
            // Resume uses the same engine as start(), just from the current state.
            val plan = currentPlan ?: return
            mutableTelemetry.value = mutableTelemetry.value.copy(status = SimulationStatus.RUNNING)

            tickingJob?.cancel()
            tickingJob = scope.launch {
                val frameIntervalMs = 33
                val scaledDeltaSec = frameIntervalMs / 1000.0 * playbackSpeedX

                while (true) {
                    delay(frameIntervalMs.toLong())
                    val current = mutableTelemetry.value
                    if (current.status == SimulationStatus.COMPLETED) break
                    if (current.status != SimulationStatus.RUNNING) continue

                    val next = DroneSimulator.step(current, plan, SprayConfig(), scaledDeltaSec)
                    mutableTelemetry.value = next
                    if (next.status == SimulationStatus.COMPLETED) break
                }
            }
        }
    }

    override suspend fun restart() {
        val plan = currentPlan ?: return
        tickingJob?.cancel()
        mutableTelemetry.value = DroneSimulator.init(plan).copy(status = SimulationStatus.IDLE)
    }

    override suspend fun stop() {
        tickingJob?.cancel()
        mutableTelemetry.value = SimulationState(status = SimulationStatus.IDLE)
        currentPlan = null
    }
}
