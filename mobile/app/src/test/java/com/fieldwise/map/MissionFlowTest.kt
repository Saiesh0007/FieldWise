package com.fieldwise.map

import com.fieldwise.TestGeo
import com.fieldwise.TestMissions
import com.fieldwise.TestMissions.confirmed
import com.fieldwise.TestMissions.field
import com.fieldwise.TestMissions.planned
import com.fieldwise.TestMissions.withZone
import com.fieldwise.mission.ExportFormat
import com.fieldwise.model.CheckId
import com.fieldwise.model.CheckStatus
import com.fieldwise.model.MissionStatus
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.ZoneKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The zone, review and confirmation flow the screen drives: what may happen, and what each change invalidates. */
class MissionFlowTest {
    // ---- no-spray zones ----

    @Test
    fun `drawing a zone adds it with a numbered name`() {
        val state = withZone(field(), 80.0, 30.0, 120.0, 70.0, ZoneKind.WATER)
        assertEquals(1, state.zones.size)
        assertEquals("Water 1", state.zones[0].name)
        assertNull(state.zoneDraft)
        assertNull(state.notice)
    }

    @Test
    fun `zone numbers keep counting after one is removed`() {
        var state = withZone(field(), 10.0, 10.0, 30.0, 30.0, at = 1L)
        state = withZone(state, 50.0, 10.0, 70.0, 30.0, at = 2L)
        state = state.removeZone(state.zones[0].id)
        state = withZone(state, 90.0, 10.0, 110.0, 30.0, at = 3L)
        assertEquals(listOf("Water 2", "Water 3"), state.zones.map { it.name })
        assertEquals(2, state.zones.map { it.id }.toSet().size)
    }

    @Test
    fun `a zone needs three corners and must touch the field`() {
        val started = field().startZone(ZoneKind.ROAD)
        val two = started.withVertex(TestGeo.ll(10.0, 10.0)).withVertex(TestGeo.ll(20.0, 20.0)).finishZone(1L)
        assertNotNull(two.notice)
        assertTrue(two.zones.isEmpty())

        val outside = withZone(field(), 500.0, 500.0, 540.0, 540.0)
        assertTrue(outside.zones.isEmpty())
        assertTrue(outside.notice!!.contains("outside the field"))
    }

    @Test
    fun `a self-intersecting zone is refused`() {
        var state = field().startZone(ZoneKind.OBSTACLE)
        listOf(10.0 to 10.0, 50.0 to 50.0, 50.0 to 10.0, 10.0 to 50.0).forEach { state = state.withVertex(TestGeo.ll(it.first, it.second)) }
        val finished = state.finishZone(1L)
        assertTrue(finished.zones.isEmpty())
        assertTrue(finished.notice!!.startsWith("That zone cannot be used"))
    }

    @Test
    fun `zone corners go to the zone, not the field, while drawing`() {
        val state = field().startZone().withVertex(TestGeo.ll(10.0, 10.0))
        assertEquals(4, state.vertices.size)
        assertEquals(1, state.zoneDraft!!.corners.size)
    }

    @Test
    fun `undo takes back zone corners then cancels an empty draft`() {
        var state = field().startZone().withVertex(TestGeo.ll(10.0, 10.0)).withVertex(TestGeo.ll(20.0, 10.0))
        state = state.undo()
        assertEquals(1, state.zoneDraft!!.corners.size)
        state = state.undo().undo()
        assertNull(state.zoneDraft)
        assertEquals(4, state.vertices.size)
    }

    @Test
    fun `a zone cannot be started without a field`() {
        val state = MapState().startZone()
        assertNull(state.zoneDraft)
        assertNotNull(state.notice)
    }

    @Test
    fun `the planner routes around a zone and reports its area`() {
        val state = planned(withZone(field(), 80.0, 30.0, 120.0, 70.0))
        val plan = state.sprayState.plan!!
        assertTrue(plan.metrics.noSprayAreaSqm > 1_000.0)
        val open = planned(field()).sprayState.plan!!
        assertTrue(plan.metrics.sprayableAreaSqm < open.metrics.sprayableAreaSqm)
    }

    @Test
    fun `a zone covering the whole field explains why nothing can be planned`() {
        val state = planned(withZone(field(), -10.0, -10.0, 210.0, 110.0))
        assertNull(state.sprayState.plan)
        assertNotNull(state.sprayState.error)
    }

    // ---- what changes invalidate ----

    @Test
    fun `changing anything the plan depends on drops the plan and every confirmation`() {
        val base = confirmed(field())
        assertNotNull(base.sprayState.plan)
        assertNotNull(base.confirmations.missionAt)

        val changes = mapOf(
            "a new zone" to withZone(base, 80.0, 30.0, 120.0, 70.0),
            "a parameter" to base.withSprayConfig(SprayConfig(swathWidthM = 6.0)),
            "editing parameters" to base.editSprayParameters(),
            "a corner" to base.undo(),
            "reset" to base.cleared()
        )
        changes.forEach { (what, state) ->
            assertNull("$what left the plan", state.sprayState.plan)
            assertNull("$what left a confirmation", state.confirmations.missionAt)
            assertNull("$what left a confirmation", state.confirmations.boundaryAt)
            assertNull("$what left a confirmation", state.confirmations.parametersAt)
            assertFalse("$what left the review open", state.reviewOpen)
        }
    }

    @Test
    fun `removing a zone drops the plan too`() {
        val zoned = confirmed(withZone(field(), 80.0, 30.0, 120.0, 70.0))
        val removed = zoned.removeZone(zoned.zones[0].id)
        assertNull(removed.sprayState.plan)
        assertNull(removed.confirmations.missionAt)
    }

    // ---- review and confirmation ----

    @Test
    fun `the mission cannot be confirmed before the boundary and parameters are`() {
        val planned = planned(field())
        assertNull(planned.confirmMission(5L).confirmations.missionAt)
        assertNull(planned.setBoundaryConfirmed(true, 5L).confirmMission(6L).confirmations.missionAt)
        val both = planned.setBoundaryConfirmed(true, 5L).setParametersConfirmed(true, 5L)
        assertEquals(6L, both.confirmMission(6L).confirmations.missionAt)
    }

    @Test
    fun `withdrawing a confirmation withdraws the final one`() {
        val state = confirmed(field())
        assertTrue(state.canExport(20L))
        val withdrawn = state.setBoundaryConfirmed(false, 21L)
        assertNull(withdrawn.confirmations.missionAt)
        assertFalse(withdrawn.canExport(21L))
    }

    @Test
    fun `a failing check blocks the final confirmation with an explanation`() {
        val state = planned(field().withSprayConfig(SprayConfig(tankCapacityL = 0.001)))
            .setBoundaryConfirmed(true, 1L).setParametersConfirmed(true, 1L).confirmMission(2L)
        assertNull(state.confirmations.missionAt)
        assertEquals(CheckStatus.FAIL, state.validation(3L)!!.checks.first { it.id == CheckId.FLIGHTS }.status)
        assertTrue(state.notice!!.contains("failed checks"))
    }

    @Test
    fun `a mission is a draft, then validated, then confirmed`() {
        assertNull(field().mission(1L))
        val planned = planned(field())
        assertEquals(MissionStatus.VALIDATED, planned.mission(2L)!!.status)
        val confirmed = confirmed(field())
        assertEquals(MissionStatus.CONFIRMED, confirmed.mission(30L)!!.status)
        assertEquals(10L, confirmed.mission(30L)!!.confirmedAt)

        val failing = planned(field().withSprayConfig(SprayConfig(tankCapacityL = 0.001)))
        assertEquals(MissionStatus.DRAFT, failing.mission(2L)!!.status)
    }

    @Test
    fun `the mission is a self-contained snapshot of original, corrections, zones and plan`() {
        val zoned = confirmed(withZone(field(), 80.0, 30.0, 120.0, 70.0))
        val mission = zoned.mission(40L)!!
        assertEquals(zoned.fieldId, mission.fieldId)
        assertEquals(zoned.boundaryState.history.original, mission.original)
        assertEquals(zoned.field, mission.corrected)
        assertEquals(zoned.zones, mission.zones)
        assertEquals(zoned.sprayState.plan, mission.plan)
        assertTrue(mission.report.canExport)
    }

    @Test
    fun `exports are recorded on the mission and cleared when the mission changes`() {
        val exported = confirmed(field()).recordExport(ExportFormat.KML, 50L)
        assertEquals(listOf("KML"), exported.mission(51L)!!.exports.map { it.format })
        assertTrue(exported.withSprayConfig(SprayConfig(swathWidthM = 6.0)).exports.isEmpty())
    }

    @Test
    fun `review only opens once there is a plan`() {
        assertFalse(field().openReview().reviewOpen)
        assertTrue(planned(field()).openReview().reviewOpen)
        assertFalse(planned(field()).openReview().closeReview().reviewOpen)
    }

    @Test
    fun `a GPS correction after confirmation withdraws the confirmations`() {
        val walk = listOf(90.0 to 10.0, 140.0 to 10.0, 140.0 to 90.0, 90.0 to 90.0, 90.0 to 10.0)
            .mapIndexed { i, p -> com.fieldwise.gps.GpsFix(TestGeo.ll(p.first, p.second), 3.0, i * 1000L) }
        val state = confirmed(field()).withWalkResult(com.fieldwise.gps.GpsCapture(walk, 0, 0L, 5000L)).acceptPendingCorrection(60L)
        assertTrue(state.hasCorrections)
        assertNull(state.sprayState.plan)
        assertNull(state.confirmations.missionAt)
    }
}
