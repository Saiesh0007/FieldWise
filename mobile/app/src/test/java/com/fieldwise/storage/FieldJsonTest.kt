package com.fieldwise.storage

import com.fieldwise.TestGeo
import com.fieldwise.TestMissions
import com.fieldwise.geometry.AreaOps
import com.fieldwise.gps.GpsCapture
import com.fieldwise.gps.GpsFix
import com.fieldwise.map.MapLayer
import com.fieldwise.map.MapState
import com.fieldwise.model.CostWeights
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.ZoneKind
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FieldJsonTest {
    private val walk = listOf(90.0 to 10.0, 140.0 to 10.0, 140.0 to 90.0, 90.0 to 90.0, 90.0 to 10.0)
        .mapIndexed { i, p -> GpsFix(TestGeo.ll(p.first, p.second), 3.0, i * 1000L) }
        .let { GpsCapture(it, 1, 0L, 5000L) }

    private fun rich(): MapState {
        val base = TestMissions.field()
            .withWalkResult(walk).acceptPendingCorrection(1_000L)
        val zoned = TestMissions.withZone(base, 20.0, 20.0, 40.0, 40.0, ZoneKind.BUILDING, at = 2_000L)
        return zoned
            .withSprayConfig(SprayConfig(swathWidthM = 6.0, overlapPercent = 20.0, headingDeg = 30.0, weights = CostWeights(1.0, 9.0, 2.0)))
            .withLayer(MapLayer.TOPO)
            .copy(fieldName = "North plot")
    }

    @Test
    fun `a whole field survives a save and a load`() {
        val original = rich()
        assertTrue(original.hasCorrections)

        val restored = FieldJson.decode(FieldJson.encode(original))!!

        assertEquals(original.fieldId, restored.fieldId)
        assertEquals("North plot", restored.fieldName)
        assertEquals(MapLayer.TOPO, restored.layer)
        assertEquals(original.vertices, restored.vertices)
        assertEquals(original.sprayState.config, restored.sprayState.config)
        assertNull(restored.notice)

        assertEquals(1, restored.boundaryState.history.applied.size)
        assertEquals(AreaOps.areaSqm(original.field), AreaOps.areaSqm(restored.field), 0.01)
        assertEquals(original.boundaryState.history.applied[0].gps, restored.boundaryState.history.applied[0].gps)

        assertEquals(1, restored.zones.size)
        assertEquals("Building 1", restored.zones[0].name)
        assertEquals(ZoneKind.BUILDING, restored.zones[0].kind)
        assertEquals(2_000L, restored.zones[0].createdAt)
        assertEquals(AreaOps.areaSqm(original.zones[0].polygon), AreaOps.areaSqm(restored.zones[0].polygon), 0.001)
    }

    @Test
    fun `plans and confirmations are never saved`() {
        val confirmed = TestMissions.confirmed(TestMissions.field())
        assertNotNull(confirmed.confirmations.missionAt)

        val restored = FieldJson.decode(FieldJson.encode(confirmed))!!

        assertNull(restored.sprayState.plan)
        assertNull(restored.confirmations.boundaryAt)
        assertNull(restored.confirmations.parametersAt)
        assertNull(restored.confirmations.missionAt)
        assertTrue(restored.exports.isEmpty())
    }

    @Test
    fun `an empty field round-trips`() {
        val restored = FieldJson.decode(FieldJson.encode(MapState()))!!
        assertTrue(restored.vertices.isEmpty())
        assertTrue(restored.field.isEmpty)
    }

    @Test
    fun `unreadable or unknown files are refused without throwing`() {
        assertNull(FieldJson.decode(""))
        assertNull(FieldJson.decode("not json"))
        assertNull(FieldJson.decode("[]"))
        assertNull(FieldJson.decode("{}"))
        assertNull(FieldJson.decode("{\"version\":99,\"vertices\":[]}"))
        assertNull(FieldJson.decode("{\"version\":1}"))
    }

    @Test
    fun `damaged items are dropped and reported instead of failing the whole load`() {
        val json = JSONObject(FieldJson.encode(rich()))
        json.getJSONArray("zones").put(JSONObject().put("id", "bad").put("name", "Bad").put("kind", "WATER")
            .put("polygon", JSONArray("[[[73.0,18.0],[73.1,18.1]]]")))
        json.getJSONArray("corrections").put(JSONObject().put("id", "x").put("type", "TELEPORT"))

        val restored = FieldJson.decode(json.toString())!!

        assertEquals(1, restored.zones.size)
        assertEquals(1, restored.boundaryState.history.applied.size)
        assertNotNull(restored.notice)
        assertTrue(restored.notice!!.startsWith("2 saved item(s)"))
    }

    @Test
    fun `parameters a planner would reject fall back to the defaults`() {
        val json = JSONObject(FieldJson.encode(TestMissions.field()))
        json.getJSONObject("config").put("swathWidthM", -5.0)
        assertEquals(SprayConfig(), FieldJson.decode(json.toString())!!.sprayState.config)
    }

    @Test
    fun `the save key changes only when something worth saving changes`() {
        val state = TestMissions.field()
        assertEquals(state.persistKey(), state.withNotice("hello").withLayer(MapLayer.SATELLITE).persistKey())
        assertTrue(state.persistKey() != state.withLayer(MapLayer.STREET).persistKey())
        assertTrue(state.persistKey() != TestMissions.withZone(state, 10.0, 10.0, 30.0, 30.0).persistKey())
    }
}
