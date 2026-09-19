package com.fieldwise.mission

import com.fieldwise.TestGeo
import com.fieldwise.TestMissions
import com.fieldwise.map.MapState
import com.fieldwise.model.CheckId
import com.fieldwise.model.CheckStatus
import com.fieldwise.model.Correction
import com.fieldwise.model.GpsStats
import com.fieldwise.model.NoSprayZone
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.SprayPlan
import com.fieldwise.model.ValidationReport
import com.fieldwise.model.ZoneKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MissionValidatorTest {
    private fun status(report: ValidationReport, id: CheckId) = report.checks.first { it.id == id }.status

    private fun report(
        state: MapState,
        plan: SprayPlan = state.sprayState.plan!!,
        zones: List<NoSprayZone> = state.zones,
        config: SprayConfig = state.sprayState.config,
        corrections: List<Correction> = state.boundaryState.history.applied,
        confirmed: Boolean = true
    ) = MissionValidator.validate(
        field = state.field, zones = zones, config = config, plan = plan, corrections = corrections,
        boundaryConfirmedAt = if (confirmed) 1L else null, parametersConfirmedAt = if (confirmed) 1L else null, nowMs = 5L
    )

    @Test
    fun `a sound confirmed mission passes every check that can fail`() {
        val state = TestMissions.planned(TestMissions.field())
        val r = report(state)
        assertEquals(CheckId.values().toSet(), r.checks.map { it.id }.toSet())
        assertTrue(r.failures.joinToString { "${it.id}: ${it.detail}" }, r.canExport)
        listOf(
            CheckId.BOUNDARY_VALID, CheckId.ZONES_VALID, CheckId.PLAN_CURRENT, CheckId.PARAMETERS_VALID,
            CheckId.PATH_INSIDE_FIELD, CheckId.PATH_AVOIDS_ZONES, CheckId.START_END_VALID, CheckId.FLIGHTS,
            CheckId.BOUNDARY_CONFIRMED, CheckId.PARAMETERS_CONFIRMED
        ).forEach { assertEquals(it.name, CheckStatus.PASS, status(r, it)) }
    }

    @Test
    fun `an unconfirmed mission cannot be exported but is otherwise sound`() {
        val r = report(TestMissions.planned(TestMissions.field()), confirmed = false)
        assertFalse(r.canExport)
        assertEquals(CheckStatus.FAIL, status(r, CheckId.BOUNDARY_CONFIRMED))
        assertEquals(CheckStatus.FAIL, status(r, CheckId.PARAMETERS_CONFIRMED))
        assertTrue(r.problemsOtherThanConfirmations().isEmpty())
    }

    @Test
    fun `a route planned around a zone is verified as avoiding it`() {
        val state = TestMissions.planned(TestMissions.withZone(TestMissions.field(), 80.0, 30.0, 120.0, 70.0))
        assertNotNull(state.sprayState.plan)
        val r = report(state)
        assertEquals(CheckStatus.PASS, status(r, CheckId.PATH_AVOIDS_ZONES))
        assertEquals(CheckStatus.PASS, status(r, CheckId.PLAN_CURRENT))
        assertTrue(r.canExport)
    }

    @Test
    fun `the route is measured itself, not trusted, so a zone added afterwards is caught`() {
        val state = TestMissions.planned(TestMissions.field())
        val lateZone = TestGeo.zone(60.0, 20.0, 140.0, 80.0)
        val r = report(state, zones = listOf(lateZone))
        assertEquals(CheckStatus.FAIL, status(r, CheckId.PATH_AVOIDS_ZONES))
        assertEquals(CheckStatus.FAIL, status(r, CheckId.PLAN_CURRENT))
        assertFalse(r.canExport)
    }

    @Test
    fun `a plan computed for other parameters is stale`() {
        val state = TestMissions.planned(TestMissions.field())
        val r = report(state, config = SprayConfig(swathWidthM = 8.0))
        assertEquals(CheckStatus.FAIL, status(r, CheckId.PLAN_CURRENT))
    }

    @Test
    fun `a zone outside the field only warns`() {
        val state = TestMissions.planned(TestMissions.field())
        val r = report(state, zones = listOf(TestGeo.zone(500.0, 500.0, 540.0, 540.0)))
        assertEquals(CheckStatus.WARN, status(r, CheckId.ZONES_VALID))
    }

    @Test
    fun `a self-intersecting zone fails and the route is not measured against it`() {
        val state = TestMissions.planned(TestMissions.field())
        val bowtie = NoSprayZone("z", "Bad", ZoneKind.OBSTACLE, TestGeo.polygon(10.0 to 10.0, 50.0 to 50.0, 50.0 to 10.0, 10.0 to 50.0), 0L)
        val r = report(state, zones = listOf(bowtie))
        assertEquals(CheckStatus.FAIL, status(r, CheckId.ZONES_VALID))
        assertEquals(CheckStatus.FAIL, status(r, CheckId.PATH_AVOIDS_ZONES))
    }

    @Test
    fun `poor GPS accuracy on a walked correction warns`() {
        val state = TestMissions.planned(TestMissions.field())
        val stats = GpsStats(40, 2, 120.0, meanAccuracyM = 8.0, worstAccuracyM = 12.0, startedAt = 0L, endedAt = 1L)
        val walked = Correction.AddArea("c", 0L, TestGeo.polygon(0.0 to 0.0, 10.0 to 0.0, 10.0 to 10.0), stats)
        assertEquals(CheckStatus.WARN, status(report(state, corrections = listOf(walked)), CheckId.GPS_ACCURACY))
        assertEquals(CheckStatus.PASS, status(report(state), CheckId.GPS_ACCURACY))
    }

    @Test
    fun `coverage below the thresholds warns and then blocks`() {
        val state = TestMissions.planned(TestMissions.field())
        val plan = state.sprayState.plan!!
        fun coverage(pct: Double) = plan.copy(
            metrics = plan.metrics.copy(coveredAreaSqm = plan.metrics.sprayableAreaSqm * pct / 100.0)
        )
        assertEquals(CheckStatus.PASS, status(report(state, plan = coverage(95.0)), CheckId.COVERAGE))
        assertEquals(CheckStatus.WARN, status(report(state, plan = coverage(70.0)), CheckId.COVERAGE))
        assertEquals(CheckStatus.FAIL, status(report(state, plan = coverage(30.0)), CheckId.COVERAGE))
    }

    @Test
    fun `a flight that exceeds the tank is a failure`() {
        val tiny = SprayConfig(tankCapacityL = 0.001)
        val state = TestMissions.planned(TestMissions.field().withSprayConfig(tiny))
        assertNotNull(state.sprayState.error, state.sprayState.plan)
        val r = report(state)
        assertEquals(CheckStatus.FAIL, status(r, CheckId.FLIGHTS))
        assertTrue(r.problemsOtherThanConfirmations().isNotEmpty())
    }
}
