package com.fieldwise.mission

import com.fieldwise.geo.LocalProjection
import com.fieldwise.geometry.AreaOps
import com.fieldwise.geometry.Jts
import com.fieldwise.gps.GpsPolicy
import com.fieldwise.model.Check
import com.fieldwise.model.CheckId
import com.fieldwise.model.CheckStatus
import com.fieldwise.model.Correction
import com.fieldwise.model.GeoArea
import com.fieldwise.model.LatLng
import com.fieldwise.model.NoSprayZone
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.SprayPlan
import com.fieldwise.model.ValidationReport
import com.fieldwise.planner.SprayPathPlanner
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.geom.Geometry
import org.locationtech.jts.operation.union.UnaryUnionOp
import java.util.Locale

object Safety {
    const val DISCLAIMER =
        "FieldWise is a planning tool. Passing these checks does not guarantee a safe flight. Flying remains subject " +
            "to local aviation regulations, your operating procedures, the manufacturer's requirements, site " +
            "conditions, weather, the aircraft's limits and your own judgment."
}

/** Checks that need the pilot rather than the geometry, so they are excluded when asking "is the mission itself sound?". */
val CONFIRMATION_CHECKS = setOf(CheckId.BOUNDARY_CONFIRMED, CheckId.PARAMETERS_CONFIRMED)

fun ValidationReport.problemsOtherThanConfirmations(): List<Check> = failures.filter { it.id !in CONFIRMATION_CHECKS }

/**
 * Independent pre-flight checks on a finished plan. The route is re-measured against the field and the no-spray zones
 * here rather than trusting the planner, and the pilot's confirmations are part of the report so an unconfirmed
 * mission can never look ready.
 */
object MissionValidator {
    /** Below this share of the sprayable area the pilot is warned; below [COVERAGE_FAIL_BELOW] the mission is blocked. */
    const val COVERAGE_WARN_BELOW = 90.0
    const val COVERAGE_FAIL_BELOW = 50.0

    /** Slack for floating-point error when testing containment, in metres. */
    private const val TOLERANCE_M = 0.05

    private val LABELS = mapOf(
        CheckId.BOUNDARY_VALID to "Boundary is valid",
        CheckId.ZONES_VALID to "No-spray zones are valid",
        CheckId.PLAN_CURRENT to "Route matches the field, zones and parameters",
        CheckId.PARAMETERS_VALID to "Spray parameters are valid",
        CheckId.PATH_INSIDE_FIELD to "Route stays inside the field",
        CheckId.PATH_AVOIDS_ZONES to "Route avoids no-spray zones",
        CheckId.START_END_VALID to "Start and end points are valid",
        CheckId.COVERAGE to "Coverage of the sprayable area",
        CheckId.FLIGHTS to "Flights fit the tank and battery",
        CheckId.GPS_ACCURACY to "GPS accuracy of field corrections",
        CheckId.BOUNDARY_CONFIRMED to "Pilot confirmed the corrected boundary",
        CheckId.PARAMETERS_CONFIRMED to "Pilot confirmed the spray parameters"
    )

    private fun check(id: CheckId, status: CheckStatus, detail: String? = null) =
        Check(id, LABELS.getValue(id), status, detail)

    private fun fmt(pattern: String, vararg args: Any) = String.format(Locale.ROOT, pattern, *args)

    fun validate(
        field: GeoArea,
        zones: List<NoSprayZone>,
        config: SprayConfig,
        plan: SprayPlan,
        corrections: List<Correction>,
        boundaryConfirmedAt: Long?,
        parametersConfirmedAt: Long?,
        nowMs: Long
    ): ValidationReport {
        val boundary = boundary(field)
        val zoneCheck = zones(field, zones)
        val route = if (boundary.status == CheckStatus.FAIL || zoneCheck.status == CheckStatus.FAIL) {
            unchecked("The boundary or a zone is invalid, so the route could not be measured against it.")
        } else {
            routeChecks(field, zones, plan)
        }
        val checks = listOf(
            boundary,
            zoneCheck,
            planCurrent(field, zones, config, plan),
            parameters(config)
        ) + route + listOf(
            coverage(plan),
            flights(plan, config),
            gpsAccuracy(corrections),
            confirmation(CheckId.BOUNDARY_CONFIRMED, boundaryConfirmedAt),
            confirmation(CheckId.PARAMETERS_CONFIRMED, parametersConfirmedAt)
        )
        return ValidationReport(checks, nowMs)
    }

    private fun boundary(field: GeoArea): Check {
        val issue = AreaOps.validate(field).firstOrNull()
        return if (issue == null) {
            check(CheckId.BOUNDARY_VALID, CheckStatus.PASS, fmt("%.2f ha", AreaOps.areaSqm(field) / 10_000.0))
        } else {
            check(CheckId.BOUNDARY_VALID, CheckStatus.FAIL, issue.message)
        }
    }

    private fun zones(field: GeoArea, zones: List<NoSprayZone>): Check {
        if (zones.isEmpty()) return check(CheckId.ZONES_VALID, CheckStatus.PASS, "No no-spray zones were drawn.")
        zones.forEach { zone ->
            val issue = AreaOps.validate(zone.polygon).firstOrNull()
            if (issue != null) return check(CheckId.ZONES_VALID, CheckStatus.FAIL, "${zone.name}: ${issue.message}")
        }
        val fieldArea = AreaOps.areaSqm(field)
        val outside = zones.firstOrNull { zone ->
            fieldArea - AreaOps.areaSqm(AreaOps.difference(field, zone.polygon)) < AreaOps.MIN_AREA_SQM
        }
        if (outside != null) {
            return check(CheckId.ZONES_VALID, CheckStatus.WARN, "${outside.name} is outside the field, so it has no effect.")
        }
        return check(CheckId.ZONES_VALID, CheckStatus.PASS, "${zones.size} zone(s) defined.")
    }

    private fun planCurrent(field: GeoArea, zones: List<NoSprayZone>, config: SprayConfig, plan: SprayPlan): Check =
        if (plan.inputsHash == SprayPathPlanner.inputsHash(field, zones, config)) {
            check(CheckId.PLAN_CURRENT, CheckStatus.PASS)
        } else {
            check(
                CheckId.PLAN_CURRENT,
                CheckStatus.FAIL,
                "The field, zones or parameters changed after the route was generated. Generate it again."
            )
        }

    private fun parameters(config: SprayConfig): Check {
        val problem = config.problems().firstOrNull()
        return if (problem == null) {
            check(
                CheckId.PARAMETERS_VALID,
                CheckStatus.PASS,
                fmt(
                    "Width %.1f m, overlap %.0f%%, %.1f m/s at %.0f m.",
                    config.swathWidthM, config.overlapPercent, config.speedMps, config.altitudeM
                )
            )
        } else {
            check(CheckId.PARAMETERS_VALID, CheckStatus.FAIL, problem)
        }
    }

    private fun unchecked(reason: String) = listOf(
        check(CheckId.PATH_INSIDE_FIELD, CheckStatus.FAIL, reason),
        check(CheckId.PATH_AVOIDS_ZONES, CheckStatus.FAIL, reason),
        check(CheckId.START_END_VALID, CheckStatus.FAIL, reason)
    )

    /** Every leg the drone actually flies: each spray pass, and each connector that is not between two flights. */
    private fun flownLines(plan: SprayPlan, proj: LocalProjection): List<Geometry> {
        fun line(points: List<LatLng>): Geometry {
            val coordinates = points.map { proj.toLocal(it) }.map { Coordinate(it.x, it.y) }
            return Jts.factory.createLineString(coordinates.toTypedArray())
        }
        val out = ArrayList<Geometry>()
        plan.passes.forEach { out.add(line(listOf(it.start, it.end))) }
        plan.connectors.filter { !it.betweenFlights }.forEach { c ->
            out.add(line(listOf(plan.passes[c.fromPass].end) + c.via + listOf(plan.passes[c.toPass].start)))
        }
        return out
    }

    private fun routeChecks(field: GeoArea, zones: List<NoSprayZone>, plan: SprayPlan): List<Check> = try {
        val proj = LocalProjection.around(
            field.allPoints() + zones.flatMap { it.polygon.shell } + plan.passes.flatMap { listOf(it.start, it.end) }
        )
        val fieldGeometry = Jts.geometry(field, proj).buffer(TOLERANCE_M)
        val zoneGeometries = zones.mapNotNull { Jts.polygon(it.polygon, proj) }
        val zoneUnion: Geometry? = if (zoneGeometries.isEmpty()) null else UnaryUnionOp.union(zoneGeometries)
        val lines = flownLines(plan, proj)

        val outsideM = lines.sumOf { it.difference(fieldGeometry).length }
        val inZoneM = if (zoneUnion == null) 0.0 else lines.sumOf { zoneUnion.intersection(it).length }

        val waypoints = plan.waypoints()
        val endpoints = listOfNotNull(waypoints.firstOrNull(), waypoints.lastOrNull()).map {
            val l = proj.toLocal(it.point)
            Jts.factory.createPoint(Coordinate(l.x, l.y))
        }
        val badEnd = endpoints.isEmpty() ||
            endpoints.any { !fieldGeometry.covers(it) || (zoneUnion != null && zoneUnion.intersects(it)) }

        listOf(
            if (outsideM <= TOLERANCE_M) {
                check(CheckId.PATH_INSIDE_FIELD, CheckStatus.PASS)
            } else {
                check(CheckId.PATH_INSIDE_FIELD, CheckStatus.FAIL, fmt("The route leaves the field by %.1f m in total.", outsideM))
            },
            if (inZoneM <= TOLERANCE_M) {
                check(CheckId.PATH_AVOIDS_ZONES, CheckStatus.PASS)
            } else {
                check(CheckId.PATH_AVOIDS_ZONES, CheckStatus.FAIL, fmt("The route crosses a no-spray zone for %.1f m in total.", inZoneM))
            },
            if (badEnd) {
                check(CheckId.START_END_VALID, CheckStatus.FAIL, "The route starts or ends outside the field or inside a no-spray zone.")
            } else {
                check(CheckId.START_END_VALID, CheckStatus.PASS)
            }
        )
    } catch (e: RuntimeException) {
        unchecked("The route could not be checked (${e.javaClass.simpleName}).")
    }

    private fun coverage(plan: SprayPlan): Check {
        val pct = plan.metrics.coveragePercent
        val detail = fmt("An estimated %.1f%% of the sprayable area is reached by the swath.", pct)
        val status = when {
            pct < COVERAGE_FAIL_BELOW -> CheckStatus.FAIL
            pct < COVERAGE_WARN_BELOW -> CheckStatus.WARN
            else -> CheckStatus.PASS
        }
        return check(CheckId.COVERAGE, status, detail)
    }

    private fun flights(plan: SprayPlan, config: SprayConfig): Check {
        val over = plan.sorties.firstOrNull {
            it.chemicalL > config.tankCapacityL + 1e-6 || it.timeMin > config.enduranceMin + 1e-6
        }
        return if (over != null) {
            check(
                CheckId.FLIGHTS,
                CheckStatus.FAIL,
                fmt(
                    "Flight %d needs an estimated %.1f L and %.1f min, above the %.1f L tank or %.1f min battery limit.",
                    over.index + 1, over.chemicalL, over.timeMin, config.tankCapacityL, config.enduranceMin
                )
            )
        } else {
            check(
                CheckId.FLIGHTS,
                CheckStatus.PASS,
                fmt("%d flight(s), each within the tank and battery limits (estimates).", plan.sorties.size)
            )
        }
    }

    private fun gpsAccuracy(corrections: List<Correction>): Check {
        val walks = corrections.mapNotNull { it.gps }
        if (walks.isEmpty()) return check(CheckId.GPS_ACCURACY, CheckStatus.PASS, "No GPS-walked corrections were used.")
        val mean = walks.maxOf { it.meanAccuracyM }
        val worst = walks.maxOf { it.worstAccuracyM }
        return if (mean > GpsPolicy.GOOD_M || worst > GpsPolicy.FAIR_M) {
            check(
                CheckId.GPS_ACCURACY,
                CheckStatus.WARN,
                fmt(
                    "GPS accuracy was about ±%.0f m (worst ±%.0f m), so the corrected edge may be off by that much. " +
                        "Phone GPS is not survey grade.",
                    mean, worst
                )
            )
        } else {
            check(
                CheckId.GPS_ACCURACY,
                CheckStatus.PASS,
                fmt("About ±%.0f m. Phone GPS is not survey grade; check the edge on the map.", mean)
            )
        }
    }

    private fun confirmation(id: CheckId, at: Long?): Check =
        if (at != null) check(id, CheckStatus.PASS) else check(id, CheckStatus.FAIL, "Not confirmed yet.")
}
