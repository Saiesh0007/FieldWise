package com.fieldwise.geometry

import com.fieldwise.geo.LocalProjection
import com.fieldwise.geo.PlaneMath
import com.fieldwise.geo.XY
import com.fieldwise.model.GeoArea
import com.fieldwise.model.GeoPolygon
import com.fieldwise.model.LatLng
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.operation.valid.IsValidOp

enum class IssueKind { EMPTY, TOO_FEW_POINTS, TOO_SMALL, SELF_INTERSECTION }

data class BoundaryIssue(val kind: IssueKind, val message: String, val at: LatLng? = null)

/** Area calculations, polygon booleans and validity checks, all done in a local metric frame. */
object AreaOps {
    /** Anything smaller than this cannot be a field or a correction. */
    const val MIN_AREA_SQM = 1.0

    /** Fragments left behind by a boolean operation below this size are dropped. */
    const val SLIVER_SQM = 0.5

    private fun projectionFor(vararg groups: List<LatLng>): LocalProjection =
        LocalProjection.around(groups.asList().flatten())

    fun areaSqm(area: GeoArea): Double {
        if (area.isEmpty) return 0.0
        return Jts.geometry(area, projectionFor(area.allPoints())).area
    }

    fun areaSqm(polygon: GeoPolygon): Double = areaSqm(GeoArea.of(polygon))

    /** Ring area from the shoelace formula in the local frame. */
    fun ringAreaSqm(ring: List<LatLng>): Double {
        val proj = projectionFor(ring)
        return PlaneMath.shoelaceArea(ring.map { proj.toLocal(it) })
    }

    fun union(area: GeoArea, polygon: GeoPolygon): GeoArea {
        val proj = projectionFor(area.allPoints(), polygon.shell)
        val poly = Jts.polygon(polygon, proj) ?: return area
        val base = Jts.geometry(area, proj)
        return Jts.toArea(base.union(poly), proj)
    }

    fun difference(area: GeoArea, polygon: GeoPolygon): GeoArea {
        val proj = projectionFor(area.allPoints(), polygon.shell)
        val poly = Jts.polygon(polygon, proj) ?: return area
        val base = Jts.geometry(area, proj)
        return Jts.toArea(base.difference(poly), proj)
    }

    fun contains(area: GeoArea, point: LatLng): Boolean {
        if (area.isEmpty) return false
        val proj = projectionFor(area.allPoints())
        val l = proj.toLocal(point)
        return Jts.geometry(area, proj).covers(Jts.factory.createPoint(Coordinate(l.x, l.y)))
    }

    fun centroid(area: GeoArea): LatLng? {
        if (area.isEmpty) return null
        val proj = projectionFor(area.allPoints())
        val c = Jts.geometry(area, proj).centroid.coordinate ?: return null
        return proj.toGeo(XY(c.x, c.y))
    }

    /** Empty when [area] can be planned with. Self-intersections come with the location of the first problem. */
    fun validate(area: GeoArea): List<BoundaryIssue> {
        if (area.isEmpty) return listOf(BoundaryIssue(IssueKind.EMPTY, "There is no boundary yet."))
        area.polygons.forEach {
            if (it.shell.size < 3) {
                return listOf(BoundaryIssue(IssueKind.TOO_FEW_POINTS, "A boundary needs at least 3 corners."))
            }
        }
        val proj = projectionFor(area.allPoints())
        val geometry = Jts.geometry(area, proj)
        val error = IsValidOp(geometry).validationError
        if (error != null) {
            val at = error.coordinate?.let { proj.toGeo(XY(it.x, it.y)) }
            return listOf(
                BoundaryIssue(
                    IssueKind.SELF_INTERSECTION,
                    "The boundary overlaps itself. Please correct the highlighted area.",
                    at
                )
            )
        }
        if (geometry.area < MIN_AREA_SQM) {
            return listOf(BoundaryIssue(IssueKind.TOO_SMALL, "The area is too small to be a field."))
        }
        return emptyList()
    }

    fun validate(polygon: GeoPolygon): List<BoundaryIssue> = validate(GeoArea.of(polygon))

    /** Drops slivers and tiny holes that boolean operations can leave behind. */
    fun cleaned(area: GeoArea, minSqm: Double = SLIVER_SQM): GeoArea {
        val polygons = area.polygons.mapNotNull { p ->
            if (areaSqm(p) < minSqm) null
            else p.copy(holes = p.holes.filter { ringAreaSqm(it) >= minSqm })
        }
        return GeoArea(polygons)
    }
}
