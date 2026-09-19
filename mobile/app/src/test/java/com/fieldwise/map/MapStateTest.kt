package com.fieldwise.map

import com.fieldwise.TestGeo
import com.fieldwise.geometry.AreaOps
import com.fieldwise.gps.GpsCapture
import com.fieldwise.gps.GpsFix
import com.fieldwise.model.SprayConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The trace -> correct -> plan flow the map screen drives, exercised without a device. */
class MapStateTest {
    private fun traced(vararg xy: Pair<Double, Double>): MapState =
        xy.fold(MapState()) { state, p -> state.withVertex(TestGeo.ll(p.first, p.second)) }

    private fun field100() = traced(0.0 to 0.0, 100.0 to 0.0, 100.0 to 100.0, 0.0 to 100.0)

    private fun planned(state: MapState): MapState {
        val started = state.beginPlanning()
        val inputs = started.planInputs()
        return started.withPlanResult(inputs.plan(), inputs)
    }

    private fun walk(vararg xy: Pair<Double, Double>): GpsCapture {
        val fixes = xy.mapIndexed { i, p -> GpsFix(TestGeo.ll(p.first, p.second), 3.0, i * 1000L) }
        return GpsCapture(fixes, 0, 0L, xy.size * 1000L)
    }

    private fun area(state: MapState) = AreaOps.areaSqm(state.field)

    // ---- tracing ----

    @Test
    fun `tapping four corners builds a field of the right size`() {
        val state = field100()
        assertFalse(state.field.isEmpty)
        assertEquals(10_000.0, area(state), 100.0)
    }

    @Test
    fun `fewer than three corners is not a field`() {
        val state = traced(0.0 to 0.0, 50.0 to 0.0)
        assertTrue(state.field.isEmpty)
        assertTrue(state.boundaryIssues().isEmpty())
    }

    @Test
    fun `undo removes the last corner`() {
        val state = field100().undo()
        assertEquals(3, state.vertices.size)
        assertEquals(5_000.0, area(state), 100.0)
    }

    @Test
    fun `cleared forgets the boundary and the plan`() {
        val state = planned(field100()).cleared()
        assertTrue(state.field.isEmpty)
        assertTrue(state.vertices.isEmpty())
        assertNull(state.sprayState.plan)
    }

    // ---- planning ----

    @Test
    fun `a traced field can be planned and covers most of the area`() {
        val state = planned(field100())
        val plan = state.sprayState.plan
        assertNotNull(state.sprayState.error, plan)
        assertFalse(state.sprayState.planning)
        assertNull(state.sprayState.error)
        assertTrue(plan!!.passes.isNotEmpty())
        assertTrue("coverage was ${plan.metrics.coveragePercent}", plan.metrics.coveragePercent > 85.0)
    }

    @Test
    fun `planning without a field explains what to do and does not start`() {
        val state = MapState().beginPlanning()
        assertFalse(state.sprayState.planning)
        assertNotNull(state.sprayState.error)
    }

    @Test
    fun `a self-intersecting boundary reports a problem instead of a plan`() {
        val state = planned(traced(0.0 to 0.0, 100.0 to 100.0, 100.0 to 0.0, 0.0 to 100.0))
        assertNull(state.sprayState.plan)
        assertFalse(state.sprayState.planning)
        assertNotNull(state.sprayState.error)
        assertTrue(state.boundaryIssues().isNotEmpty())
    }

    @Test
    fun `editing the boundary discards a plan that no longer matches it`() {
        val state = planned(field100())
        assertNotNull(state.sprayState.plan)
        assertNull(state.undo().sprayState.plan)
        assertNull(state.withVertex(TestGeo.ll(150.0, 50.0)).sprayState.plan)
    }

    @Test
    fun `changing spray parameters discards the plan`() {
        val state = planned(field100())
        val changed = state.withSprayConfig(SprayConfig(swathWidthM = 6.0))
        assertNull(changed.sprayState.plan)
        assertEquals(6.0, changed.sprayState.config.swathWidthM, 0.0)
    }

    @Test
    fun `a plan that finishes after the boundary changed is ignored`() {
        val started = field100().beginPlanning()
        assertTrue(started.sprayState.planning)
        val inputs = started.planInputs()
        val result = inputs.plan()

        val edited = started.undo()
        val applied = edited.withPlanResult(result, inputs)

        assertNull(applied.sprayState.plan)
        assertFalse(applied.sprayState.planning)
    }

    // ---- GPS corrections ----

    @Test
    fun `an accepted GPS loop outside the field adds area and can be undone`() {
        val before = field100()
        val walked = before.withWalkResult(walk(90.0 to 10.0, 140.0 to 10.0, 140.0 to 90.0, 90.0 to 90.0, 90.0 to 10.0))
        val pending = walked.boundaryState.pendingCorrection
        assertNotNull(walked.notice, pending)
        assertEquals("ADD", pending!!.kind)

        val accepted = walked.acceptPendingCorrection(1_000L)
        assertNull(accepted.boundaryState.pendingCorrection)
        assertTrue(accepted.hasCorrections)
        assertTrue("area was ${area(accepted)}", area(accepted) > 12_500.0)

        val undone = accepted.undo()
        assertFalse(undone.hasCorrections)
        assertEquals(10_000.0, area(undone), 100.0)
    }

    @Test
    fun `an accepted GPS loop inside the field removes area`() {
        val walked = field100().withWalkResult(walk(40.0 to 40.0, 70.0 to 40.0, 70.0 to 70.0, 40.0 to 70.0, 40.0 to 40.0))
        assertEquals("REMOVE", walked.boundaryState.pendingCorrection!!.kind)

        val accepted = walked.acceptPendingCorrection(1_000L)
        assertTrue("area was ${area(accepted)}", area(accepted) < 9_500.0)
    }

    @Test
    fun `accepting a correction discards the old plan`() {
        val walked = planned(field100()).withWalkResult(walk(90.0 to 10.0, 140.0 to 10.0, 140.0 to 90.0, 90.0 to 90.0, 90.0 to 10.0))
        val accepted = walked.acceptPendingCorrection(1_000L)
        assertNull(accepted.sprayState.plan)
    }

    @Test
    fun `a walk that is too short is refused with a message`() {
        val state = field100().withWalkResult(walk(10.0 to 10.0, 11.0 to 10.0))
        assertNull(state.boundaryState.pendingCorrection)
        assertNotNull(state.notice)
    }

    @Test
    fun `tapping the map cannot discard a correction`() {
        val accepted = field100()
            .withWalkResult(walk(90.0 to 10.0, 140.0 to 10.0, 140.0 to 90.0, 90.0 to 90.0, 90.0 to 10.0))
            .acceptPendingCorrection(1_000L)
        val tapped = accepted.withVertex(TestGeo.ll(300.0, 300.0))
        assertEquals(accepted.field, tapped.field)
        assertTrue(tapped.hasCorrections)
    }

    @Test
    fun `tapping is ignored while a correction is waiting for review`() {
        val pending = field100().withWalkResult(walk(90.0 to 10.0, 140.0 to 10.0, 140.0 to 90.0, 90.0 to 90.0, 90.0 to 10.0))
        assertNotNull(pending.boundaryState.pendingCorrection)
        val tapped = pending.withVertex(TestGeo.ll(300.0, 300.0))
        assertNotNull(tapped.boundaryState.pendingCorrection)
        assertEquals(4, tapped.vertices.size)
    }

    @Test
    fun `rejecting a correction leaves the boundary untouched`() {
        val before = field100()
        val rejected = before
            .withWalkResult(walk(90.0 to 10.0, 140.0 to 10.0, 140.0 to 90.0, 90.0 to 90.0, 90.0 to 10.0))
            .rejectPendingCorrection()
        assertNull(rejected.boundaryState.pendingCorrection)
        assertEquals(before.field, rejected.field)
    }
}
