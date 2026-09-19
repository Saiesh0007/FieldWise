package com.fieldwise.mission

import com.fieldwise.TestMissions
import com.fieldwise.map.MapState
import com.fieldwise.model.Mission
import com.fieldwise.model.MissionStatus
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.util.Locale
import javax.xml.parsers.DocumentBuilderFactory

class MissionExportTest {
    private val zoned: MapState = TestMissions.confirmed(TestMissions.withZone(TestMissions.field(), 80.0, 30.0, 120.0, 70.0))

    private fun mission(state: MapState = zoned): Mission = state.mission(20L)!!

    private fun features(json: JSONObject) = json.getJSONArray("features").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }

    private fun role(feature: JSONObject) = feature.getJSONObject("properties").getString("role")

    @Test
    fun `only a confirmed mission can be exported`() {
        assertEquals(MissionStatus.CONFIRMED, mission().status)
        val unconfirmed = TestMissions.planned(TestMissions.field()).mission(20L)!!
        ExportFormat.values().forEach { format ->
            try {
                MissionExport.render(unconfirmed, format)
                fail("${format.label} was exported without confirmation")
            } catch (expected: IllegalStateException) {
                assertTrue(expected.message!!.contains("confirmed"))
            }
        }
    }

    @Test
    fun `a mission with a failed check is refused even if marked confirmed`() {
        val m = mission()
        val failing = m.report.copy(checks = m.report.checks.map { if (it.id.name == "COVERAGE") it.copy(status = com.fieldwise.model.CheckStatus.FAIL) else it })
        try {
            MissionExport.render(m.copy(report = failing), ExportFormat.GEOJSON)
            fail("exported despite a failed check")
        } catch (expected: IllegalStateException) {
            // expected
        }
    }

    @Test
    fun `GeoJSON carries the field, the zone, every pass and every flight`() {
        val m = mission()
        val json = JSONObject(MissionExport.render(m, ExportFormat.GEOJSON))
        assertEquals("FeatureCollection", json.getString("type"))

        val roles = features(json).map { role(it) }
        assertEquals(1, roles.count { it == "corrected_boundary" })
        assertEquals(1, roles.count { it == "original_boundary" })
        assertEquals(1, roles.count { it == "no_spray_zone" })
        assertEquals(m.plan.passes.size, roles.count { it == "spray_pass" })
        assertEquals(m.plan.sorties.size, roles.count { it == "flight_route" })

        val info = json.getJSONObject("fieldwise")
        assertEquals("CONFIRMED", info.getString("status"))
        assertEquals(CheckCount, info.getJSONArray("validation").length())
        assertTrue(info.getString("disclaimer").contains("planning tool"))
        assertTrue(info.getJSONArray("estimatedValues").length() > 0)
        assertEquals(m.plan.metrics.sortieCount, info.getJSONObject("metrics").getInt("flightCount"))
    }

    @Test
    fun `GeoJSON positions are longitude then latitude within the field`() {
        val boundary = features(JSONObject(MissionExport.render(mission(), ExportFormat.GEOJSON))).first { role(it) == "corrected_boundary" }
        val ring = boundary.getJSONObject("geometry").getJSONArray("coordinates").getJSONArray(0)
        val first = ring.getJSONArray(0)
        assertEquals(73.8567, first.getDouble(0), 0.01)
        assertEquals(18.5204, first.getDouble(1), 0.01)
        assertEquals(ring.getJSONArray(0).toString(), ring.getJSONArray(ring.length() - 1).toString())
    }

    @Test
    fun `flight routes carry the flight altitude`() {
        val route = features(JSONObject(MissionExport.render(mission(), ExportFormat.GEOJSON))).first { role(it) == "flight_route" }
        val coordinate = route.getJSONObject("geometry").getJSONArray("coordinates").getJSONArray(0)
        assertEquals(3, coordinate.length())
        assertEquals(mission().plan.altitudeM, coordinate.getDouble(2), 0.0)
    }

    @Test
    fun `KML is well-formed and lists boundary, zone and flights`() {
        val m = mission()
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(ByteArrayInputStream(MissionExport.render(m, ExportFormat.KML).toByteArray(Charsets.UTF_8)))
        val placemarks = doc.getElementsByTagName("Placemark")
        assertEquals(2 + m.zones.size + m.plan.sorties.size, placemarks.length)
        assertNotNull(doc.getElementsByTagName("LineString").item(0))
    }

    @Test
    fun `KML escapes markup in names`() {
        val nasty = zoned.copy(fieldName = "Ravi & Sons <north> \"plot\"")
        val xml = MissionExport.render(mission(nasty), ExportFormat.KML)
        DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(ByteArrayInputStream(xml.toByteArray(Charsets.UTF_8)))
        assertFalse(xml.contains("<north>"))
    }

    @Test
    fun `CSV has one row per waypoint in flight order`() {
        val m = mission()
        val lines = MissionExport.render(m, ExportFormat.CSV).trimEnd().split("\r\n")
        assertEquals("seq,flight,pass,action,latitude,longitude,altitude_m", lines[0])
        assertEquals(m.plan.waypoints().size, lines.size - 1)
        assertTrue(lines[1].startsWith("1,1,1,SPRAY_ON,"))
        lines.drop(1).forEach { assertEquals(7, it.split(",").size) }
    }

    @Test
    fun `files use dots for decimals whatever the phone language`() {
        val saved = Locale.getDefault()
        try {
            Locale.setDefault(Locale.GERMANY)
            val csv = MissionExport.render(mission(), ExportFormat.CSV)
            assertTrue(csv.lines()[1].split(",")[4].matches(Regex("-?\\d+\\.\\d{7}")))
            JSONObject(MissionExport.render(mission(), ExportFormat.GEOJSON))
            DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(ByteArrayInputStream(MissionExport.render(mission(), ExportFormat.KML).toByteArray(Charsets.UTF_8)))
        } finally {
            Locale.setDefault(saved)
        }
    }

    @Test
    fun `file names are safe and carry the extension`() {
        val m = mission(zoned.copy(fieldName = "Ravi's North/Plot #2"))
        ExportFormat.values().forEach { format ->
            val name = MissionExport.fileName(m, format)
            assertTrue(name, name.matches(Regex("fieldwise-[a-z0-9-]+-\\d{8}-\\d{4}\\.${format.extension}")))
        }
        assertNull(Regex("[/\\\\ ]").find(MissionExport.fileName(m, ExportFormat.KML)))
    }

    private companion object {
        val CheckCount = com.fieldwise.model.CheckId.values().size
    }
}
