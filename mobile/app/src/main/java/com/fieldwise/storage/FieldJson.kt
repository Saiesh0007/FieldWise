package com.fieldwise.storage

import com.fieldwise.correction.EditHistory
import com.fieldwise.geometry.GeoJsonCodec
import com.fieldwise.map.BoundaryState
import com.fieldwise.map.MapLayer
import com.fieldwise.map.MapState
import com.fieldwise.map.SprayState
import com.fieldwise.model.CostWeights
import com.fieldwise.model.Correction
import com.fieldwise.model.GeoArea
import com.fieldwise.model.GeoPolygon
import com.fieldwise.model.GpsStats
import com.fieldwise.model.LatLng
import com.fieldwise.model.NoSprayZone
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.ZoneKind
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * The saved form of a field: traced corners, accepted GPS corrections, no-spray zones, parameters and layer.
 * Plans and the pilot's confirmations are deliberately not saved: a route is recomputed and every sign-off is given
 * again, so nothing is ever exported on the strength of yesterday's confirmation.
 */
object FieldJson {
    const val VERSION = 1

    fun encode(state: MapState): String {
        val corners = JSONArray().also { a -> state.vertices.forEach { a.put(GeoJsonCodec.position(it)) } }
        val corrections = JSONArray().also { a -> state.boundaryState.history.applied.forEach { a.put(correction(it)) } }
        val zones = JSONArray().also { a -> state.zones.forEach { a.put(zone(it)) } }
        return JSONObject()
            .put("version", VERSION)
            .put("fieldId", state.fieldId)
            .put("fieldName", state.fieldName)
            .put("layer", state.layer.name)
            .put("config", config(state.sprayState.config))
            .put("vertices", corners)
            .put("corrections", corrections)
            .put("zones", zones)
            .toString()
    }

    /** Returns null for anything unreadable or from an unknown version, and never throws. */
    fun decode(text: String): MapState? = try {
        parse(JSONObject(text))
    } catch (e: JSONException) {
        null
    } catch (e: IllegalArgumentException) {
        null
    }

    // ---- writing ----

    private fun config(c: SprayConfig) = JSONObject()
        .put("swathWidthM", c.swathWidthM)
        .put("overlapPercent", c.overlapPercent)
        .put("speedMps", c.speedMps)
        .put("altitudeM", c.altitudeM)
        .put("applicationRateLPerHa", c.applicationRateLPerHa)
        .put("tankCapacityL", c.tankCapacityL)
        .put("enduranceMin", c.enduranceMin)
        .put("turnPenaltySec", c.turnPenaltySec)
        .put("driftInsetM", c.driftInsetM)
        .put("headingDeg", c.headingDeg ?: JSONObject.NULL)
        .put(
            "weights",
            JSONObject()
                .put("flightDistance", c.weights.flightDistance)
                .put("turn", c.weights.turn)
                .put("deadhead", c.weights.deadhead)
        )

    private fun zone(z: NoSprayZone) = JSONObject()
        .put("id", z.id)
        .put("name", z.name)
        .put("kind", z.kind.name)
        .put("createdAt", z.createdAt)
        .put("polygon", GeoJsonCodec.polygonCoordinates(z.polygon))

    private fun gps(s: GpsStats) = JSONObject()
        .put("fixCount", s.fixCount)
        .put("droppedFixes", s.droppedFixes)
        .put("lengthMeters", s.lengthMeters)
        .put("meanAccuracyM", s.meanAccuracyM)
        .put("worstAccuracyM", s.worstAccuracyM)
        .put("startedAt", s.startedAt)
        .put("endedAt", s.endedAt)

    private fun correction(c: Correction): JSONObject {
        val o = JSONObject().put("id", c.id).put("createdAt", c.createdAt)
        when (c) {
            is Correction.AddArea -> o.put("type", "ADD").put("polygon", GeoJsonCodec.polygonCoordinates(c.polygon))
            is Correction.RemoveArea -> o.put("type", "REMOVE").put("polygon", GeoJsonCodec.polygonCoordinates(c.polygon))
            is Correction.MoveVertex -> o.put("type", "MOVE")
                .put("from", GeoJsonCodec.position(c.from)).put("to", GeoJsonCodec.position(c.to))
        }
        c.gps?.let { o.put("gps", gps(it)) }
        return o
    }

    // ---- reading ----

    private fun parseConfig(o: JSONObject?): SprayConfig {
        val d = SprayConfig()
        if (o == null) return d
        val weights = o.optJSONObject("weights")
        val parsed = SprayConfig(
            swathWidthM = o.optDouble("swathWidthM", d.swathWidthM),
            overlapPercent = o.optDouble("overlapPercent", d.overlapPercent),
            speedMps = o.optDouble("speedMps", d.speedMps),
            altitudeM = o.optDouble("altitudeM", d.altitudeM),
            applicationRateLPerHa = o.optDouble("applicationRateLPerHa", d.applicationRateLPerHa),
            tankCapacityL = o.optDouble("tankCapacityL", d.tankCapacityL),
            enduranceMin = o.optDouble("enduranceMin", d.enduranceMin),
            turnPenaltySec = o.optDouble("turnPenaltySec", d.turnPenaltySec),
            driftInsetM = o.optDouble("driftInsetM", d.driftInsetM),
            headingDeg = if (o.isNull("headingDeg")) null else o.getDouble("headingDeg"),
            weights = CostWeights(
                flightDistance = weights?.optDouble("flightDistance", d.weights.flightDistance) ?: d.weights.flightDistance,
                turn = weights?.optDouble("turn", d.weights.turn) ?: d.weights.turn,
                deadhead = weights?.optDouble("deadhead", d.weights.deadhead) ?: d.weights.deadhead
            )
        )
        // A damaged or hand-edited file must not produce parameters the planner would reject.
        return if (parsed.problems().isEmpty()) parsed else d
    }

    private fun parseGps(o: JSONObject?): GpsStats? = o?.let {
        GpsStats(
            fixCount = it.getInt("fixCount"),
            droppedFixes = it.getInt("droppedFixes"),
            lengthMeters = it.getDouble("lengthMeters"),
            meanAccuracyM = it.getDouble("meanAccuracyM"),
            worstAccuracyM = it.getDouble("worstAccuracyM"),
            startedAt = it.getLong("startedAt"),
            endedAt = it.getLong("endedAt")
        )
    }

    private fun parseZone(o: JSONObject): NoSprayZone? {
        val polygon = GeoJsonCodec.polygonFromCoordinates(o.getJSONArray("polygon")) ?: return null
        val kind = ZoneKind.values().firstOrNull { it.name == o.optString("kind") } ?: ZoneKind.OTHER
        return NoSprayZone(o.getString("id"), o.getString("name"), kind, polygon, o.optLong("createdAt"))
    }

    private fun parseCorrection(o: JSONObject): Correction? {
        val id = o.getString("id")
        val createdAt = o.optLong("createdAt")
        val gps = parseGps(o.optJSONObject("gps"))
        return when (o.getString("type")) {
            "ADD" -> GeoJsonCodec.polygonFromCoordinates(o.getJSONArray("polygon"))
                ?.let { Correction.AddArea(id, createdAt, it, gps) }
            "REMOVE" -> GeoJsonCodec.polygonFromCoordinates(o.getJSONArray("polygon"))
                ?.let { Correction.RemoveArea(id, createdAt, it, gps) }
            "MOVE" -> Correction.MoveVertex(
                id, createdAt, GeoJsonCodec.latLng(o.getJSONArray("from")), GeoJsonCodec.latLng(o.getJSONArray("to"))
            )
            else -> null
        }
    }

    /** Parses each object, counting the ones that were malformed instead of failing the whole file. */
    private fun <T : Any> JSONArray?.mapEach(transform: (JSONObject) -> T?): Pair<List<T>, Int> {
        if (this == null) return emptyList<T>() to 0
        val kept = ArrayList<T>()
        var dropped = 0
        for (i in 0 until length()) {
            val item = try {
                optJSONObject(i)?.let { transform(it) }
            } catch (e: JSONException) {
                null
            }
            if (item != null) kept.add(item) else dropped++
        }
        return kept to dropped
    }

    private fun parse(root: JSONObject): MapState? {
        if (root.optInt("version", -1) != VERSION) return null

        val vertices = root.getJSONArray("vertices").let { a -> (0 until a.length()).map { GeoJsonCodec.latLng(a.getJSONArray(it)) } }
        val (corrections, badCorrections) = root.optJSONArray("corrections").mapEach { parseCorrection(it) }
        val (zones, badZones) = root.optJSONArray("zones").mapEach { parseZone(it) }

        val traced = if (vertices.size >= 3) GeoArea.of(GeoPolygon(vertices)) else GeoArea.EMPTY
        val history = EditHistory.start(traced, corrections)
        val left = badCorrections + badZones + (corrections.size - history.applied.size)

        return MapState(
            fieldId = root.optString("fieldId").ifEmpty { MapState().fieldId },
            fieldName = root.optString("fieldName").ifEmpty { "Field" },
            vertices = vertices,
            layer = MapLayer.values().firstOrNull { it.name == root.optString("layer") } ?: MapLayer.SATELLITE,
            boundaryState = BoundaryState(history = history),
            sprayState = SprayState(config = parseConfig(root.optJSONObject("config"))),
            zones = zones,
            notice = if (left > 0) {
                "$left saved item(s) could not be restored. Check the boundary and no-spray zones before planning."
            } else {
                null
            }
        )
    }
}
