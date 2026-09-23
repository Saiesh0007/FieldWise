package com.fieldwise.mission

import com.fieldwise.geometry.GeoJsonCodec
import com.fieldwise.model.Mission
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Persists and restores mission history, following the same versioned-envelope pattern as FieldJson. */
object MissionJson {
    const val VERSION = 1

    fun encode(records: List<MissionRecord>): String {
        val arr = JSONArray()
        records.forEach { record ->
            arr.put(
                JSONObject()
                    .put("name", record.name)
                    .put("savedAt", record.savedAt)
                    .put("mission", encodeMission(record.mission))
            )
        }
        return JSONObject()
            .put("version", VERSION)
            .put("records", arr)
            .toString()
    }

    fun decode(text: String): List<MissionRecord>? = try {
        parse(JSONObject(text))
    } catch (e: JSONException) {
        null
    } catch (e: IllegalArgumentException) {
        null
    }

    private fun encodeMission(m: Mission): JSONObject {
        val obj = JSONObject()
        obj.put("id", m.id)
        obj.put("fieldId", m.fieldId)
        obj.put("fieldName", m.fieldName)
        obj.put("createdAt", m.createdAt)
        obj.put("status", m.status.name)
        obj.put("confirmedAt", m.confirmedAt ?: JSONObject.NULL)
        // Encode the boundary and zones as GeoJSON
        m.original.polygons.forEachIndexed { i, polygon ->
            if (i == 0) {
                GeoJsonCodec.geometry(com.fieldwise.model.GeoArea.of(polygon), 7)?.let {
                    obj.put("original", it)
                }
            }
        }
        m.corrected.polygons.forEachIndexed { i, polygon ->
            if (i == 0) {
                GeoJsonCodec.geometry(com.fieldwise.model.GeoArea.of(polygon), 7)?.let {
                    obj.put("corrected", it)
                }
            }
        }
        obj.put("zones", JSONArray().also { zones ->
            m.zones.forEach { zone ->
                zones.put(
                    JSONObject()
                        .put("id", zone.id)
                        .put("name", zone.name)
                        .put("kind", zone.kind.name)
                        .put("polygon", GeoJsonCodec.polygonCoordinates(zone.polygon))
                )
            }
        })
        // Plan metrics
        obj.put("metrics", JSONObject().apply {
            val metrics = m.plan.metrics
            put("fieldAreaHa", metrics.fieldAreaSqm / 10_000.0)
            put("sprayableAreaHa", metrics.sprayableAreaSqm / 10_000.0)
            put("coveredAreaHa", metrics.coveredAreaSqm / 10_000.0)
            put("coveragePercent", metrics.coveragePercent)
            put("distanceM", metrics.totalDistanceM)
            put("timeMin", metrics.flightTimeMin)
            put("chemicalL", metrics.chemicalL)
        })
        return obj
    }

    private fun parse(root: JSONObject): List<MissionRecord>? {
        if (root.optInt("version", -1) != VERSION) return null
        val records = ArrayList<MissionRecord>()
        val arr = root.optJSONArray("records") ?: return emptyList<MissionRecord>()
        for (i in 0 until arr.length()) {
            try {
                val obj = arr.getJSONObject(i)
                // For now, we just store the name, timestamp, and a subset of mission data.
                // A full parse would deserialize the entire Mission object.
                val record = MissionRecord(
                    name = obj.getString("name"),
                    savedAt = obj.getLong("savedAt"),
                    mission = Mission(
                        id = obj.getString("id"),
                        fieldId = obj.getString("fieldId"),
                        fieldName = obj.getString("fieldName"),
                        createdAt = obj.getLong("createdAt"),
                        status = com.fieldwise.model.MissionStatus.valueOf(obj.getString("status")),
                        confirmedAt = if (obj.isNull("confirmedAt")) null else obj.getLong("confirmedAt"),
                        config = com.fieldwise.model.SprayConfig(),
                        original = com.fieldwise.model.GeoArea.EMPTY,
                        corrected = com.fieldwise.model.GeoArea.EMPTY,
                        zones = emptyList(),
                        corrections = emptyList(),
                        plan = com.fieldwise.model.SprayPlan(
                            headingDeg = 0.0,
                            passes = emptyList(),
                            connectors = emptyList(),
                            sorties = emptyList(),
                            candidates = emptyList(),
                            metrics = com.fieldwise.model.PlanMetrics(
                                fieldAreaSqm = 0.0,
                                noSprayAreaSqm = 0.0,
                                sprayableAreaSqm = 0.0,
                                coveredAreaSqm = 0.0,
                                sprayDistanceM = 0.0,
                                transitDistanceM = 0.0,
                                turns = 0,
                                passCount = 0,
                                sortieCount = 0,
                                flightTimeMin = 0.0,
                                chemicalL = 0.0
                            ),
                            inputsHash = 0,
                            altitudeM = 0.0,
                            notes = emptyList()
                        ),
                        report = com.fieldwise.model.ValidationReport(emptyList(), 0L),
                        exports = emptyList()
                    )
                )
                records.add(record)
            } catch (e: JSONException) {
                // Skip malformed entries, like FieldJson does.
                continue
            }
        }
        return records
    }
}
