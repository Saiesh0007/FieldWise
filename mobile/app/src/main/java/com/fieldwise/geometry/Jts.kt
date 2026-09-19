package com.fieldwise.geometry

import com.fieldwise.geo.LocalProjection
import com.fieldwise.geo.XY
import com.fieldwise.model.GeoArea
import com.fieldwise.model.GeoPolygon
import com.fieldwise.model.LatLng
import org.locationtech.jts.algorithm.Orientation
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.geom.Geometry
import org.locationtech.jts.geom.GeometryCollection
import org.locationtech.jts.geom.GeometryFactory
import org.locationtech.jts.geom.LineString
import org.locationtech.jts.geom.Polygon

/** Converts between geographic model types and JTS geometry in a local metric frame. */
internal object Jts {
    val factory = GeometryFactory()

    private fun closedCoords(points: List<LatLng>, proj: LocalProjection): Array<Coordinate> {
        val coords = ArrayList<Coordinate>(points.size + 1)
        for (p in points) {
            val l = proj.toLocal(p)
            coords.add(Coordinate(l.x, l.y))
        }
        coords.add(Coordinate(coords[0]))
        return coords.toTypedArray()
    }

    /** Null when the shell has fewer than 3 points, which cannot form a ring. */
    fun polygon(p: GeoPolygon, proj: LocalProjection): Polygon? {
        if (p.shell.size < 3) return null
        val shell = factory.createLinearRing(closedCoords(p.shell, proj))
        val holes = p.holes.filter { it.size >= 3 }
            .map { factory.createLinearRing(closedCoords(it, proj)) }
            .toTypedArray()
        return factory.createPolygon(shell, holes)
    }

    fun geometry(area: GeoArea, proj: LocalProjection): Geometry =
        factory.createMultiPolygon(area.polygons.mapNotNull { polygon(it, proj) }.toTypedArray())

    fun toArea(g: Geometry, proj: LocalProjection): GeoArea {
        val out = ArrayList<GeoPolygon>()
        collect(g, proj, out)
        return GeoArea(out)
    }

    private fun collect(g: Geometry, proj: LocalProjection, out: MutableList<GeoPolygon>) {
        when {
            g.isEmpty -> Unit
            g is Polygon -> out.add(fromJts(g, proj))
            g is GeometryCollection -> for (i in 0 until g.numGeometries) collect(g.getGeometryN(i), proj, out)
        }
    }

    /** Output follows RFC 7946: shell counter-clockwise, holes clockwise. */
    fun fromJts(p: Polygon, proj: LocalProjection): GeoPolygon {
        val shell = ringPoints(p.exteriorRing, proj, ccw = true)
        val holes = (0 until p.numInteriorRing).map { ringPoints(p.getInteriorRingN(it), proj, ccw = false) }
        return GeoPolygon(shell, holes)
    }

    private fun ringPoints(ring: LineString, proj: LocalProjection, ccw: Boolean): List<LatLng> {
        val coords = ring.coordinates
        val open = coords.dropLast(1)
        val ordered = if (Orientation.isCCW(coords) == ccw) open else open.reversed()
        return ordered.map { proj.toGeo(XY(it.x, it.y)) }
    }

    fun xy(c: Coordinate) = XY(c.x, c.y)
}
