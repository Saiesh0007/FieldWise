package com.fieldwise.correction

import com.fieldwise.geo.LocalProjection
import com.fieldwise.geo.PlaneMath
import com.fieldwise.geo.XY
import com.fieldwise.geometry.AreaOps
import com.fieldwise.geometry.Jts
import com.fieldwise.gps.GpsCapture
import com.fieldwise.gps.GpsPolicy
import com.fieldwise.model.GeoArea
import com.fieldwise.model.GeoPolygon
import com.fieldwise.model.GpsStats
import com.fieldwise.model.LatLng
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.geom.Geometry
import org.locationtech.jts.geom.LineString
import org.locationtech.jts.geom.Polygon
import org.locationtech.jts.geom.util.GeometryFixer
import org.locationtech.jts.linearref.LengthIndexedLine
import org.locationtech.jts.operation.valid.IsValidOp
import org.locationtech.jts.simplify.DouglasPeuckerSimplifier
import kotlin.math.max
import kotlin.math.roundToInt

enum class CorrectionKind { ADD, REMOVE }

enum class ClosureMethod(val label: String) {
    CLOSED_LOOP("You walked a closed loop."),
    SNAPPED_TO_BOUNDARY("The walked line was joined to the current boundary at both ends."),
    STRAIGHT_CHORD("The walked line did not start and end on the current boundary, so it was closed with a straight line.")
}

data class TrackOptions(
    val thinMeters: Double = 1.5,
    val simplifyMeters: Double = 0.75,
    val minLengthM: Double = 5.0,
    /** Start and end within this distance (or 1.5 x the mean GPS error) count as a closed loop. */
    val closeToleranceM: Double = 4.0,
    /** An end within this distance (or 3 x the mean GPS error) of the boundary is joined to it. */
    val snapToleranceM: Double = 12.0
)

data class TrackCorrection(
    val polygon: GeoPolygon,
    /** The polygon is added to the field when the walk was mostly outside it, removed when mostly inside. */
    val suggestedKind: CorrectionKind,
    val method: ClosureMethod,
    val polygonAreaSqm: Double,
    /** The cleaned track, for drawing. */
    val track: List<LatLng>,
    val stats: GpsStats,
    val warnings: List<String>
)

sealed interface TrackResult {
    data class Ok(val correction: TrackCorrection) : TrackResult
    data class Failed(val reason: String) : TrackResult
}

/**
 * Turns a walked GPS track into a correction polygon:
 *  - a closed loop becomes the polygon itself;
 *  - an open line that starts and ends at the current boundary is closed along the boundary (the shorter way round),
 *    so the polygon is the sliver between the old edge and the walked edge;
 *  - anything else is closed with a straight line and flagged.
 * Nothing is committed here; the pilot reviews the result first.
 */
object GpsTrackConverter {
    private const val TOO_SHORT = "The captured track is too short. Walk a little further along the changed edge."

    fun convert(capture: GpsCapture, field: GeoArea, options: TrackOptions = TrackOptions()): TrackResult {
        if (capture.fixes.size < 3) return TrackResult.Failed(TOO_SHORT)

        val proj = LocalProjection.around(field.allPoints() + capture.fixes.map { it.point })
        val raw = capture.fixes.map { proj.toLocal(it.point) }
        val track = simplify(PlaneMath.thin(raw, options.thinMeters), options.simplifyMeters)
        val length = PlaneMath.pathLength(track)
        if (track.size < 3 || length < options.minLengthM) return TrackResult.Failed(TOO_SHORT)

        val meanAccuracy = capture.fixes.map { it.accuracyM }.average()
        val worstAccuracy = capture.fixes.maxOf { it.accuracyM }
        val stats = GpsStats(
            fixCount = capture.fixes.size,
            droppedFixes = capture.droppedFixes,
            lengthMeters = length,
            meanAccuracyM = meanAccuracy,
            worstAccuracyM = worstAccuracy,
            startedAt = capture.startedAt,
            endedAt = capture.endedAt
        )

        val fieldGeometry: Geometry? = if (field.isEmpty) null else Jts.geometry(field, proj)
        val closeTolerance = max(options.closeToleranceM, 1.5 * meanAccuracy)
        val snapTolerance = max(options.snapToleranceM, 3.0 * meanAccuracy)

        val built: Built? = when {
            track.size >= 4 && PlaneMath.dist(track.first(), track.last()) <= closeTolerance ->
                closedLoop(track) ?: return TrackResult.Failed("The walked loop crosses itself. Walk one clean line or loop.")
            fieldGeometry != null -> snapped(track, fieldGeometry, snapTolerance) ?: chord(track)
            else -> chord(track)
        }
        if (built == null) {
            return TrackResult.Failed("The walked line crosses itself. Walk one clean line along the changed edge.")
        }
        if (built.polygon.area < AreaOps.MIN_AREA_SQM) {
            return TrackResult.Failed("The captured area is too small to be a correction.")
        }

        // Measured by length, not by point count: the ends sit on the boundary and must not tip the balance.
        val trackLine = Jts.factory.createLineString(track.map { Coordinate(it.x, it.y) }.toTypedArray())
        val insideFraction = if (fieldGeometry == null || trackLine.length <= 0.0) 0.0
        else fieldGeometry.intersection(trackLine).length / trackLine.length
        val kind = if (insideFraction >= 0.5) CorrectionKind.REMOVE else CorrectionKind.ADD

        val warnings = buildList {
            if (meanAccuracy > GpsPolicy.GOOD_M) {
                add("Average GPS accuracy was ±${meanAccuracy.roundToInt()} m, so the edge may be off by that much.")
            }
            if (worstAccuracy > GpsPolicy.FAIR_M) add("Worst accepted fix was ±${worstAccuracy.roundToInt()} m.")
            if (capture.droppedFixes > 0) {
                add("${capture.droppedFixes} fixes were ignored because they were worse than ±${GpsPolicy.DROP_M.roundToInt()} m.")
            }
            if (built.method == ClosureMethod.STRAIGHT_CHORD) add(built.method.label)
        }

        return TrackResult.Ok(
            TrackCorrection(
                polygon = Jts.fromJts(built.polygon, proj),
                suggestedKind = kind,
                method = built.method,
                polygonAreaSqm = built.polygon.area,
                track = track.map { proj.toGeo(it) },
                stats = stats,
                warnings = warnings
            )
        )
    }

    private class Built(val polygon: Polygon, val method: ClosureMethod)

    private fun simplify(points: List<XY>, tolerance: Double): List<XY> {
        if (points.size < 3) return points
        val line = Jts.factory.createLineString(points.map { Coordinate(it.x, it.y) }.toTypedArray())
        return DouglasPeuckerSimplifier.simplify(line, tolerance).coordinates.map { XY(it.x, it.y) }
    }

    /** Drops points within 1 cm of the previous one; a snapped end and the first fix would otherwise nearly coincide. */
    private fun withoutNearDuplicates(coords: List<Coordinate>): List<Coordinate> {
        val out = ArrayList<Coordinate>(coords.size)
        for (c in coords) if (out.isEmpty() || out.last().distance(c) >= 0.01) out.add(c)
        if (out.size > 1 && out.last().distance(out.first()) < 0.01) out.removeAt(out.size - 1)
        return out
    }

    /**
     * A simple polygon from the ring, or null. Overlapping edges and spikes, such as a walk that follows the old
     * boundary for a while before leaving it, are repaired. A line that genuinely crosses itself splits into several
     * pieces when repaired; that is refused because it is unclear which piece was meant.
     */
    private fun validPolygon(coords: List<Coordinate>): Polygon? {
        val cleaned = withoutNearDuplicates(coords)
        if (cleaned.size < 3) return null
        val ring = try {
            Jts.factory.createLinearRing((cleaned + cleaned[0]).toTypedArray())
        } catch (e: IllegalArgumentException) {
            return null
        }
        val polygon = Jts.factory.createPolygon(ring)
        if (IsValidOp(polygon).isValid) return polygon
        val fixed = GeometryFixer.fix(polygon)
        if (fixed.numGeometries != 1) return null
        val single = fixed.getGeometryN(0) as? Polygon ?: return null
        return single.takeIf { !it.isEmpty && IsValidOp(it).isValid }
    }

    private fun closedLoop(track: List<XY>): Built? {
        val polygon = validPolygon(track.map { Coordinate(it.x, it.y) }) ?: return null
        return Built(polygon, ClosureMethod.CLOSED_LOOP)
    }

    private fun chord(track: List<XY>): Built? {
        val polygon = validPolygon(track.map { Coordinate(it.x, it.y) }) ?: return null
        return Built(polygon, ClosureMethod.STRAIGHT_CHORD)
    }

    private fun boundaryRings(field: Geometry): List<LineString> {
        val rings = mutableListOf<LineString>()
        for (i in 0 until field.numGeometries) {
            val part = field.getGeometryN(i)
            if (part is Polygon) {
                rings.add(part.exteriorRing)
                for (h in 0 until part.numInteriorRing) rings.add(part.getInteriorRingN(h))
            }
        }
        return rings
    }

    /** Forward arc along a closed ring from [from] to [to] (lengths along the ring), wrapping past the ring start. */
    private fun arc(index: LengthIndexedLine, ringLength: Double, from: Double, to: Double): List<Coordinate> =
        if (from <= to) {
            index.extractLine(from, to).coordinates.toList()
        } else {
            index.extractLine(from, ringLength).coordinates.toList() +
                index.extractLine(0.0, to).coordinates.toList().drop(1)
        }

    private fun snapped(track: List<XY>, field: Geometry, tolerance: Double): Built? {
        val first = Jts.factory.createPoint(Coordinate(track.first().x, track.first().y))
        val last = Jts.factory.createPoint(Coordinate(track.last().x, track.last().y))

        var ring: LineString? = null
        var bestScore = Double.MAX_VALUE
        for (candidate in boundaryRings(field)) {
            val score = max(candidate.distance(first), candidate.distance(last))
            if (score < bestScore) {
                bestScore = score
                ring = candidate
            }
        }
        if (ring == null || bestScore > tolerance) return null

        val index = LengthIndexedLine(ring)
        val ringLength = ring.length
        val ia = index.project(first.coordinate)
        val ib = index.project(last.coordinate)
        val a = index.extractPoint(ia)
        val b = index.extractPoint(ib)
        val trackCoords = track.map { Coordinate(it.x, it.y) }

        // Both ways round the ring close the walked line; the smaller valid polygon is the changed sliver.
        val arcBtoA = arc(index, ringLength, ib, ia)
        val arcAtoB = arc(index, ringLength, ia, ib).reversed()
        val candidates = listOf(arcBtoA, arcAtoB).mapNotNull { way ->
            validPolygon(listOf(a) + trackCoords + listOf(b) + way.drop(1).dropLast(1))
        }
        val best = candidates.minByOrNull { it.area } ?: return null
        return Built(best, ClosureMethod.SNAPPED_TO_BOUNDARY)
    }
}
