package com.fieldwise

import com.fieldwise.map.MapState
import com.fieldwise.model.ZoneKind

/** Builds map states the way the app does, by tapping, so tests exercise the same paths as the screen. */
object TestMissions {
    fun field(width: Double = 200.0, height: Double = 100.0): MapState =
        listOf(0.0 to 0.0, width to 0.0, width to height, 0.0 to height)
            .fold(MapState()) { state, p -> state.withVertex(TestGeo.ll(p.first, p.second)) }

    fun withZone(
        state: MapState,
        x0: Double, y0: Double, x1: Double, y1: Double,
        kind: ZoneKind = ZoneKind.WATER,
        at: Long = 1L
    ): MapState {
        var s = state.startZone(kind)
        listOf(x0 to y0, x1 to y0, x1 to y1, x0 to y1).forEach { s = s.withVertex(TestGeo.ll(it.first, it.second)) }
        return s.finishZone(at)
    }

    fun planned(state: MapState): MapState {
        val started = state.beginPlanning()
        val inputs = started.planInputs()
        return started.withPlanResult(inputs.plan(), inputs)
    }

    /** Planned, with all three pilot confirmations given. */
    fun confirmed(state: MapState, at: Long = 10L): MapState =
        planned(state).setBoundaryConfirmed(true, at).setParametersConfirmed(true, at).confirmMission(at)
}
