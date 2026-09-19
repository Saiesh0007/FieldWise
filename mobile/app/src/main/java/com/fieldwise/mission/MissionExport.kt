package com.fieldwise.mission

import com.fieldwise.geometry.AreaOps
import com.fieldwise.geometry.GeoJsonCodec
import com.fieldwise.model.GeoArea
import com.fieldwise.model.GeoPolygon
import com.fieldwise.model.Mission
import com.fieldwise.model.MissionStatus
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.SprayPlan
import com.fieldwise.model.ValidationReport
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

enum class ExportFormat(val label: String, val extension: String, val mimeType: String) {
    GEOJSON("GeoJSON", "geojson", "application/geo+json"),
    KML("KML", "kml", "application/vnd.google-earth.kml+xml"),
    CSV("CSV waypoints", "csv", "text/csv")
}

/**
 * Hardware-agnostic mission files. GeoJSON is the primary format; KML opens in Google Earth and most GCS software;
 * CSV lists the ordered waypoints. No autopilot-specific format is produced: that needs simulation on real hardware first.
 */
object MissionExport {
    private const val DIGITS = GeoJsonCodec.EXPORT_DIGITS

    /** Refuses anything the pilot has not validated and confirmed, so a mission can never be exported silently. */
    fun render(mission: Mission, format: ExportFormat): String {
        check(mission.status == MissionStatus.CONFIRMED && mission.confirmedAt != null && mission.report.canExport) {
            "The mission has not been validated and confirmed by the pilot, so it cannot be exported."
        }
        return when (format) {
            ExportFormat.GEOJSON -> geoJson(mission)
            ExportFormat.KML -> kml(mission)
            ExportFormat.CSV -> csv(mission)
        }
    }

    fun fileName(mission: Mission, format: ExportFormat): String {
        val slug = mission.fieldName.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), "-").trim('-').ifEmpty { "field" }
        val stamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.ROOT).format(Date(mission.confirmedAt ?: mission.createdAt))
        return "fieldwise-$slug-$stamp.${format.extension}"
    }

    private fun iso(ms: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(ms))

    private fun hectares(sqm: Double) = Math.round(sqm / 10_000.0 * 10_000.0) / 10_000.0
    private fun round1(v: Double) = Math.round(v * 10.0) / 10.0
    private fun round2(v: Double) = Math.round(v * 100.0) / 100.0
    private fun num(v: Double, digits: Int) = String.format(Locale.ROOT, "%.${digits}f", v)

    // ---- GeoJSON ----

    private fun feature(role: String, geometry: JSONObject, vararg properties: Pair<String, Any>): JSONObject {
        val props = JSONObject().put("role", role)
        properties.forEach { (key, value) -> props.put(key, value) }
        return JSONObject().put("type", "Feature").put("properties", props).put("geometry", geometry)
    }

    private fun geoJson(m: Mission): String {
        val features = JSONArray()
        GeoJsonCodec.geometry(m.corrected, DIGITS)?.let {
            features.put(feature("corrected_boundary", it, "areaHa" to hectares(AreaOps.areaSqm(m.corrected))))
        }
        GeoJsonCodec.geometry(m.original, DIGITS)?.let {
            features.put(feature("original_boundary", it, "areaHa" to hectares(AreaOps.areaSqm(m.original))))
        }
        m.zones.forEach { zone ->
            GeoJsonCodec.geometry(GeoArea.of(zone.polygon), DIGITS)?.let {
                features.put(feature("no_spray_zone", it, "name" to zone.name, "kind" to zone.kind.name))
            }
        }
        m.plan.passes.forEach { pass ->
            features.put(
                feature(
                    "spray_pass",
                    GeoJsonCodec.lineString(listOf(pass.start, pass.end), DIGITS, m.plan.altitudeM),
                    "pass" to pass.index + 1,
                    "flight" to pass.sortie + 1,
                    "lengthM" to round1(pass.lengthM)
                )
            )
        }
        val waypoints = m.plan.waypoints()
        m.plan.sorties.forEach { sortie ->
            val route = waypoints.filter { it.sortie == sortie.index }.map { it.point }
            if (route.size >= 2) {
                features.put(
                    feature(
                        "flight_route",
                        GeoJsonCodec.lineString(route, DIGITS, m.plan.altitudeM),
                        "flight" to sortie.index + 1,
                        "sprayDistanceM" to round1(sortie.sprayDistanceM),
                        "estimatedTimeMin" to round1(sortie.timeMin),
                        "estimatedChemicalL" to round2(sortie.chemicalL)
                    )
                )
            }
        }

        val info = JSONObject()
            .put("schema", 1)
            .put("missionId", m.id)
            .put("fieldId", m.fieldId)
            .put("fieldName", m.fieldName)
            .put("status", m.status.name)
            .put("confirmedAt", iso(m.confirmedAt ?: m.createdAt))
            .put("parameters", parameters(m.config, m.plan))
            .put("metrics", metrics(m.plan))
            .put("estimatedValues", JSONArray(listOf("coveredAreaHa", "coveragePercent", "flightTimeMin", "chemicalL")))
            .put("validation", validation(m.report))
            .put("disclaimer", Safety.DISCLAIMER)

        return JSONObject()
            .put("type", "FeatureCollection")
            .put("name", "FieldWise mission - ${m.fieldName}")
            .put("fieldwise", info)
            .put("features", features)
            .toString(2)
    }

    private fun parameters(c: SprayConfig, plan: SprayPlan) = JSONObject()
        .put("swathWidthM", c.swathWidthM)
        .put("overlapPercent", c.overlapPercent)
        .put("effectiveSwathM", round2(c.spacingM))
        .put("speedMps", c.speedMps)
        .put("altitudeM", c.altitudeM)
        .put("applicationRateLPerHa", c.applicationRateLPerHa)
        .put("tankCapacityL", c.tankCapacityL)
        .put("enduranceMin", c.enduranceMin)
        .put("driftInsetM", c.driftInsetM)
        .put("headingDeg", round1(plan.headingDeg))

    private fun metrics(plan: SprayPlan): JSONObject {
        val m = plan.metrics
        return JSONObject()
            .put("fieldAreaHa", hectares(m.fieldAreaSqm))
            .put("noSprayAreaHa", hectares(m.noSprayAreaSqm))
            .put("sprayableAreaHa", hectares(m.sprayableAreaSqm))
            .put("coveredAreaHa", hectares(m.coveredAreaSqm))
            .put("coveragePercent", round1(m.coveragePercent))
            .put("sprayDistanceM", round1(m.sprayDistanceM))
            .put("transitDistanceM", round1(m.transitDistanceM))
            .put("totalDistanceM", round1(m.totalDistanceM))
            .put("turns", m.turns)
            .put("passCount", m.passCount)
            .put("flightCount", m.sortieCount)
            .put("flightTimeMin", round1(m.flightTimeMin))
            .put("chemicalL", round2(m.chemicalL))
    }

    private fun validation(report: ValidationReport): JSONArray = JSONArray().also { out ->
        report.checks.forEach { c ->
            val o = JSONObject().put("id", c.id.name).put("label", c.label).put("status", c.status.name)
            if (c.detail != null) o.put("detail", c.detail)
            out.put(o)
        }
    }

    // ---- KML ----

    private fun esc(text: String) = text
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;")

    private fun coordinates(ring: JSONArray, altitude: Double): String = (0 until ring.length()).joinToString(" ") { i ->
        val p = ring.getJSONArray(i)
        "${num(p.getDouble(0), DIGITS)},${num(p.getDouble(1), DIGITS)},${num(altitude, 1)}"
    }

    private fun kmlPolygon(polygon: GeoPolygon): String {
        val rings = GeoJsonCodec.polygonCoordinates(polygon, DIGITS)
        val sb = StringBuilder("<Polygon><tessellate>1</tessellate>")
        sb.append("<outerBoundaryIs><LinearRing><coordinates>").append(coordinates(rings.getJSONArray(0), 0.0))
            .append("</coordinates></LinearRing></outerBoundaryIs>")
        for (i in 1 until rings.length()) {
            sb.append("<innerBoundaryIs><LinearRing><coordinates>").append(coordinates(rings.getJSONArray(i), 0.0))
                .append("</coordinates></LinearRing></innerBoundaryIs>")
        }
        return sb.append("</Polygon>").toString()
    }

    private fun kmlArea(area: GeoArea): String {
        val polygons = area.polygons.map { kmlPolygon(it) }
        return if (polygons.size == 1) polygons[0] else "<MultiGeometry>${polygons.joinToString("")}</MultiGeometry>"
    }

    private fun kml(m: Mission): String {
        val metrics = m.plan.metrics
        val summary = String.format(
            Locale.ROOT,
            "Field %.2f ha, sprayable %.2f ha, %d flight(s), route %.0f m, about %.1f min and %.1f L (estimates). %s",
            metrics.fieldAreaSqm / 10_000.0, metrics.sprayableAreaSqm / 10_000.0, metrics.sortieCount,
            metrics.totalDistanceM, metrics.flightTimeMin, metrics.chemicalL, Safety.DISCLAIMER
        )
        val sb = StringBuilder()
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        sb.append("<kml xmlns=\"http://www.opengis.net/kml/2.2\">\n<Document>\n")
        sb.append("<name>").append(esc("FieldWise mission - ${m.fieldName}")).append("</name>\n")
        sb.append("<description>").append(esc(summary)).append("</description>\n")
        // KML colours are aabbggrr.
        sb.append("<Style id=\"corrected\"><LineStyle><color>ff76e600</color><width>3</width></LineStyle>")
            .append("<PolyStyle><color>2276e600</color></PolyStyle></Style>\n")
        sb.append("<Style id=\"original\"><LineStyle><color>ffb0b0b0</color><width>2</width></LineStyle>")
            .append("<PolyStyle><fill>0</fill></PolyStyle></Style>\n")
        sb.append("<Style id=\"zone\"><LineStyle><color>ff2617ff</color><width>2</width></LineStyle>")
            .append("<PolyStyle><color>662617ff</color></PolyStyle></Style>\n")
        sb.append("<Style id=\"route\"><LineStyle><color>ff435cff</color><width>3</width></LineStyle></Style>\n")

        sb.append("<Folder><name>Boundary</name>\n")
        if (!m.corrected.isEmpty) {
            sb.append("<Placemark><name>Corrected boundary</name><styleUrl>#corrected</styleUrl>")
                .append(kmlArea(m.corrected)).append("</Placemark>\n")
        }
        if (!m.original.isEmpty) {
            sb.append("<Placemark><name>Original boundary</name><styleUrl>#original</styleUrl>")
                .append(kmlArea(m.original)).append("</Placemark>\n")
        }
        sb.append("</Folder>\n")

        sb.append("<Folder><name>No-spray zones</name>\n")
        m.zones.forEach { zone ->
            sb.append("<Placemark><name>").append(esc(zone.name)).append("</name><description>")
                .append(esc(zone.kind.label)).append("</description><styleUrl>#zone</styleUrl>")
                .append(kmlPolygon(zone.polygon)).append("</Placemark>\n")
        }
        sb.append("</Folder>\n")

        sb.append("<Folder><name>Flights</name>\n")
        val waypoints = m.plan.waypoints()
        m.plan.sorties.forEach { sortie ->
            val points = waypoints.filter { it.sortie == sortie.index }
            if (points.size >= 2) {
                val line = points.joinToString(" ") {
                    "${num(it.point.lng, DIGITS)},${num(it.point.lat, DIGITS)},${num(it.altitudeM, 1)}"
                }
                sb.append("<Placemark><name>Flight ${sortie.index + 1}</name><description>")
                    .append(esc(String.format(Locale.ROOT, "About %.1f min and %.1f L (estimates)", sortie.timeMin, sortie.chemicalL)))
                    .append("</description><styleUrl>#route</styleUrl><LineString><tessellate>1</tessellate>")
                    .append("<altitudeMode>relativeToGround</altitudeMode><coordinates>").append(line)
                    .append("</coordinates></LineString></Placemark>\n")
            }
        }
        sb.append("</Folder>\n")
        return sb.append("</Document>\n</kml>\n").toString()
    }

    // ---- CSV ----

    /** One row per waypoint in flight order. seq, flight and pass are 1-based; pass is empty for transit points. */
    private fun csv(m: Mission): String {
        val sb = StringBuilder("seq,flight,pass,action,latitude,longitude,altitude_m\r\n")
        m.plan.waypoints().forEach { w ->
            sb.append(w.seq + 1).append(',')
                .append(w.sortie + 1).append(',')
                .append(w.pass?.let { it + 1 } ?: "").append(',')
                .append(w.action.name).append(',')
                .append(num(w.point.lat, DIGITS)).append(',')
                .append(num(w.point.lng, DIGITS)).append(',')
                .append(num(w.altitudeM, 1)).append("\r\n")
        }
        return sb.toString()
    }
}
