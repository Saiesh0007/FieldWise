package com.fieldwise.planner

import com.fieldwise.geo.LocalProjection
import com.fieldwise.geo.PlaneMath
import com.fieldwise.geo.XY
import com.fieldwise.geometry.AreaOps
import com.fieldwise.geometry.Jts
import com.fieldwise.model.CandidateResult
import com.fieldwise.model.Connector
import com.fieldwise.model.GeoArea
import com.fieldwise.model.NoSprayZone
import com.fieldwise.model.PlanMetrics
import com.fieldwise.model.Sortie
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.SprayPass
import com.fieldwise.model.SprayPlan
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.geom.Geometry
import org.locationtech.jts.geom.Polygon
import org.locationtech.jts.operation.union.UnaryUnionOp
import java.util.Objects
import kotlin.math.hypot
import kotlin.math.roundToInt

sealed interface PlanResult {
    data class Success(val plan: SprayPlan) : PlanResult
    data class Failure(val reason: PlanFailure, val message: String, val detail: String? = null) : PlanResult
}

enum class PlanFailure { INVALID_CONFIG, INVALID_BOUNDARY, NOTHING_TO_SPRAY, TOO_SMALL, INTERNAL }

/**
 * Coverage-path planner: parallel sweep lines over the sprayable region.
 *
 *  1. Sprayable area = corrected field minus no-spray zones.
 *  2. Flyable area = that, pulled back from every edge by the drift margin.
 *  3. For each candidate heading: sweep lines at the effective swath spacing, clipped to the flyable area,
 *     joined into a route whose connecting legs stay inside it.
 *  4. Cost = w1 x sprayed distance + w2 x turns + w3 x connecting distance; the cheapest heading wins.
 *  5. The route is cut into sorties by tank volume and battery time, and coverage is measured on the real geometry.
 *
 * Everything runs in a local metric frame; latitudes and longitudes appear only at the edges.
 */
object SprayPathPlanner {
    private const val MIN_PASS_M = 1.0
    private const val ANGLE_STEP_DEG = 15
    private const val EDGE_ANGLES = 3

    /** Fingerprint of the planner inputs, used to detect a stale plan after the boundary, zones or parameters change. */
    fun inputsHash(area: GeoArea, zones: List<NoSprayZone>, config: SprayConfig): Int =
        Objects.hash(area, zones.map { it.polygon }, config)

    fun plan(area: GeoArea, zones: List<NoSprayZone>, config: SprayConfig): PlanResult =
        try {
            planInternal(area, zones, config)
        } catch (e: RuntimeException) {
            PlanResult.Failure(
                PlanFailure.INTERNAL,
                "The path could not be calculated for this shape. Try simplifying the boundary or the no-spray zones.",
                "${e.javaClass.simpleName}: ${e.message}"
            )
        }

    private class Evaluated(
        val angle: Double,
        val legs: List<RouteLeg>,
        val sprayDistance: Double,
        val deadhead: Double,
        val turns: Int,
        val cost: Double
    )

    private fun planInternal(area: GeoArea, zones: List<NoSprayZone>, config: SprayConfig): PlanResult {
        config.problems().firstOrNull()?.let { return PlanResult.Failure(PlanFailure.INVALID_CONFIG, it) }
        AreaOps.validate(area).firstOrNull()?.let { return PlanResult.Failure(PlanFailure.INVALID_BOUNDARY, it.message) }

        val projection = LocalProjection.around(area.allPoints())
        val field = Jts.geometry(area, projection)
        val zoneGeometries = zones.mapNotNull { Jts.polygon(it.polygon, projection) }
        val zoneUnion: Geometry? = if (zoneGeometries.isEmpty()) null else UnaryUnionOp.union(zoneGeometries)

        val target = if (zoneUnion == null) field else field.difference(zoneUnion)
        if (target.isEmpty || target.area < AreaOps.MIN_AREA_SQM) {
            return PlanResult.Failure(PlanFailure.NOTHING_TO_SPRAY, "The no-spray zones cover the whole field.")
        }

        val inset = config.driftInsetM
        var flyable = if (inset > 0.0) field.buffer(-inset) else field
        if (zoneUnion != null) flyable = flyable.difference(if (inset > 0.0) zoneUnion.buffer(inset) else zoneUnion)
        flyable = withoutSlivers(flyable)
        if (flyable.isEmpty) {
            return PlanResult.Failure(PlanFailure.TOO_SMALL, "The field is too small for the drift margin and no-spray zones.")
        }

        val rings = ringsOf(flyable)
        val flightArea = FlightArea(flyable)
        val spacing = config.spacingM

        val angles = config.headingDeg?.let { listOf(PlaneMath.normalizeAngle(it)) } ?: candidateAngles(field)
        val evaluated = angles.mapNotNull { evaluate(it, rings, spacing, flightArea, config) }
        val best = evaluated.minWithOrNull(compareBy<Evaluated>({ it.cost }, { it.angle }))
            ?: return PlanResult.Failure(
                PlanFailure.TOO_SMALL,
                "The field is too small for this spray width. Try a smaller width or drift margin."
            )

        return PlanResult.Success(
            assemble(best, evaluated, projection, config, field, target, zoneUnion, inputsHash(area, zones, config))
        )
    }

    private fun evaluate(
        angle: Double,
        rings: List<List<Coordinate>>,
        spacing: Double,
        area: FlightArea,
        config: SprayConfig
    ): Evaluated? {
        val legs = RouteBuilder.build(Sweep.rows(rings, angle, spacing, MIN_PASS_M), area)
        if (legs.isEmpty()) return null
        val spray = legs.sumOf { it.seg.length }
        val deadhead = legs.filter { !it.newFlight }.sumOf { it.connectorLength }
        val turns = Turns.into(legs).sum()
        val w = config.weights
        return Evaluated(angle, legs, spray, deadhead, turns, w.flightDistance * spray + w.turn * turns + w.deadhead * deadhead)
    }

    /** Every 15 degrees, plus the directions of the longest field edges (rows parallel to a long edge are usually best). */
    private fun candidateAngles(field: Geometry): List<Double> {
        val angles = ArrayList<Double>()
        var a = 0
        while (a < 180) {
            angles.add(a.toDouble())
            a += ANGLE_STEP_DEG
        }
        val edges = ArrayList<Pair<Double, Double>>()
        for (polygon in polygonsOf(field)) {
            val ring = polygon.exteriorRing.coordinates.map { XY(it.x, it.y) }
            for (i in 0 until ring.size - 1) {
                edges.add(PlaneMath.dist(ring[i], ring[i + 1]) to PlaneMath.normalizeAngle(PlaneMath.headingDeg(ring[i], ring[i + 1])))
            }
        }
        for ((_, angle) in edges.sortedByDescending { it.first }.take(EDGE_ANGLES)) {
            if (angles.none { PlaneMath.headingDiffDeg(it * 2, angle * 2) / 2.0 < 0.5 }) angles.add(angle)
        }
        return angles.sorted()
    }

    private fun assemble(
        best: Evaluated,
        all: List<Evaluated>,
        projection: LocalProjection,
        config: SprayConfig,
        field: Geometry,
        target: Geometry,
        zoneUnion: Geometry?,
        hash: Int
    ): SprayPlan {
        val legs = best.legs
        val turnsInto = Turns.into(legs)

        // Cut the route into sorties. Transit to and from the launch point is not modelled.
        class Acc {
            val passes = mutableListOf<Int>()
            var spray = 0.0
            var transit = 0.0
            var volume = 0.0
            var minutes = 0.0
        }
        val accs = mutableListOf(Acc())
        val sortieOf = IntArray(legs.size)
        var turnsFlown = 0
        for ((i, leg) in legs.withIndex()) {
            var current = accs.last()
            val length = leg.seg.length
            val volume = length * config.swathWidthM / 10_000.0 * config.applicationRateLPerHa
            var transit = if (i == 0 || leg.newFlight) 0.0 else leg.connectorLength
            var turns = if (i == 0 || leg.newFlight) 0 else turnsInto[i]
            var minutes = (transit + length) / config.speedMps / 60.0 + turns * config.turnPenaltySec / 60.0

            val full = current.passes.isNotEmpty() &&
                (current.volume + volume > config.tankCapacityL || current.minutes + minutes > config.enduranceMin)
            if (current.passes.isNotEmpty() && (leg.newFlight || full)) {
                current = Acc()
                accs.add(current)
                transit = 0.0
                turns = 0
                minutes = length / config.speedMps / 60.0
            }
            current.passes.add(i)
            current.spray += length
            current.transit += transit
            current.volume += volume
            current.minutes += minutes
            turnsFlown += turns
            sortieOf[i] = accs.size - 1
        }

        val passes = legs.mapIndexed { i, leg ->
            SprayPass(i, projection.toGeo(leg.seg.a), projection.toGeo(leg.seg.b), leg.seg.length, sortieOf[i])
        }
        val connectors = (1 until legs.size).map { i ->
            val leg = legs[i]
            val path = leg.connector
            Connector(
                fromPass = i - 1,
                toPass = i,
                via = path?.drop(1)?.dropLast(1)?.map { projection.toGeo(it) } ?: emptyList(),
                lengthM = path?.let { PlaneMath.pathLength(it) } ?: PlaneMath.dist(legs[i - 1].seg.b, leg.seg.a),
                detour = leg.detour,
                betweenFlights = sortieOf[i] != sortieOf[i - 1]
            )
        }
        val sorties = accs.mapIndexed { index, acc ->
            Sortie(index, acc.passes.map { passes[it] }, acc.spray, acc.transit, acc.volume, acc.minutes)
        }

        val covered = coveredArea(legs, config.swathWidthM, target)
        val zoneArea = zoneUnion?.intersection(field)?.area ?: 0.0
        val metrics = PlanMetrics(
            fieldAreaSqm = field.area,
            noSprayAreaSqm = zoneArea,
            sprayableAreaSqm = target.area,
            coveredAreaSqm = covered,
            sprayDistanceM = accs.sumOf { it.spray },
            transitDistanceM = accs.sumOf { it.transit },
            turns = turnsFlown,
            passCount = legs.size,
            sortieCount = accs.size,
            flightTimeMin = accs.sumOf { it.minutes },
            chemicalL = accs.sumOf { it.volume }
        )

        val notes = buildList {
            if (accs.size > 1) add("The mission needs ${accs.size} flights because of the tank or battery limits.")
            val separate = legs.count { it.newFlight }
            if (separate > 0) add("The field has separate areas that cannot be joined by an in-field path; each starts a new flight.")
            val detours = connectors.count { it.detour && !it.betweenFlights }
            if (detours > 0) add("$detours connecting legs route around no-spray zones or concave edges.")
        }

        val candidates = all.map {
            CandidateResult(it.angle, it.legs.size, it.turns, it.sprayDistance, it.deadhead, it.cost, it === best)
        }
        return SprayPlan(
            headingDeg = best.angle,
            passes = passes,
            connectors = connectors,
            sorties = sorties,
            candidates = candidates,
            metrics = metrics,
            inputsHash = hash,
            altitudeM = config.altitudeM,
            notes = notes
        )
    }

    /** Area of the sprayable region actually reached by the swath of the planned passes. */
    private fun coveredArea(legs: List<RouteLeg>, swathWidth: Double, target: Geometry): Double {
        val half = swathWidth / 2.0
        val swaths = legs.mapNotNull { leg ->
            val dx = leg.seg.b.x - leg.seg.a.x
            val dy = leg.seg.b.y - leg.seg.a.y
            val length = hypot(dx, dy)
            if (length < 1e-9) return@mapNotNull null
            val nx = -dy / length * half
            val ny = dx / length * half
            Jts.factory.createPolygon(
                arrayOf(
                    Coordinate(leg.seg.a.x + nx, leg.seg.a.y + ny),
                    Coordinate(leg.seg.b.x + nx, leg.seg.b.y + ny),
                    Coordinate(leg.seg.b.x - nx, leg.seg.b.y - ny),
                    Coordinate(leg.seg.a.x - nx, leg.seg.a.y - ny),
                    Coordinate(leg.seg.a.x + nx, leg.seg.a.y + ny)
                )
            )
        }
        if (swaths.isEmpty()) return 0.0
        return UnaryUnionOp.union(swaths).intersection(target).area
    }

    private fun polygonsOf(g: Geometry): List<Polygon> =
        (0 until g.numGeometries).mapNotNull { g.getGeometryN(it) as? Polygon }.filter { !it.isEmpty }

    private fun withoutSlivers(g: Geometry): Geometry {
        val kept = polygonsOf(g).filter { it.area >= AreaOps.SLIVER_SQM }
        return Jts.factory.createMultiPolygon(kept.toTypedArray())
    }

    private fun ringsOf(g: Geometry): List<List<Coordinate>> {
        val rings = mutableListOf<List<Coordinate>>()
        for (polygon in polygonsOf(g)) {
            rings.add(polygon.exteriorRing.coordinates.toList())
            for (h in 0 until polygon.numInteriorRing) rings.add(polygon.getInteriorRingN(h).coordinates.toList())
        }
        return rings
    }

    /** Heading label such as "90 deg" for display. */
    fun headingLabel(plan: SprayPlan): String = "${plan.headingDeg.roundToInt()}°"
}
