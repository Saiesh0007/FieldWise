package com.fieldwise.map

import android.graphics.drawable.GradientDrawable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.fieldwise.model.GeoPolygon
import com.fieldwise.model.LatLng
import com.fieldwise.model.SprayPlan
import org.osmdroid.events.MapEventsReceiver
import org.osmdroid.tileprovider.tilesource.ITileSource
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.util.MapTileIndex
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.MapEventsOverlay
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Overlay
import org.osmdroid.views.overlay.Polygon
import org.osmdroid.views.overlay.Polyline
import android.graphics.Color as AndroidColor

private val START_POINT = GeoPoint(18.5204, 73.8567)

/** The osmdroid map plus every overlay for the current [MapState]. Taps that hit nothing are reported through [onTap]. */
@Composable
internal fun FieldMap(state: MapState, onTap: (LatLng) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnTap by rememberUpdatedState(onTap)
    val dynamicOverlays = remember { ArrayList<Overlay>() }

    val mapView = remember {
        MapView(context).apply {
            setMultiTouchControls(true)
            // Pinch-zoom is enough; the built-in +/- buttons would sit under the bottom bar.
            zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
            isTilesScaledToDpi = true
            minZoomLevel = 3.0
            maxZoomLevel = 20.0
            controller.setZoom(state.zoomLevel)
            controller.setCenter(START_POINT)
            // Bottom of the overlay stack, so a tap that no line or dot claims lands here and adds a corner.
            overlays.add(
                MapEventsOverlay(object : MapEventsReceiver {
                    override fun singleTapConfirmedHelper(p: GeoPoint): Boolean {
                        currentOnTap(LatLng(p.latitude, p.longitude))
                        return true
                    }

                    override fun longPressHelper(p: GeoPoint): Boolean = false
                })
            )
        }
    }

    DisposableEffect(lifecycleOwner, mapView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            mapView.onDetach()
        }
    }

    // Open on the saved field if there is one, otherwise on the pilot's position.
    val location = state.gpsState.currentLocation
    var centred by remember { mutableStateOf(false) }
    LaunchedEffect(location, state.field) {
        if (centred) return@LaunchedEffect
        val focus = state.field.allPoints().takeIf { it.isNotEmpty() }?.let { points ->
            LatLng(points.map { it.lat }.average(), points.map { it.lng }.average())
        } ?: location
        if (focus != null) {
            mapView.controller.setCenter(GeoPoint(focus.lat, focus.lng))
            centred = true
        }
    }

    val sortieSegments = remember(state.sprayState.plan) { sortieSegments(state.sprayState.plan) }

    AndroidView(
        factory = { mapView },
        modifier = modifier,
        update = { map ->
            val source = state.layer.tileSource()
            if (map.tileProvider.tileSource.name() != source.name()) map.setTileSource(source)

            map.overlays.removeAll(dynamicOverlays.toSet())
            dynamicOverlays.clear()
            dynamicOverlays.addAll(buildOverlays(map, state, sortieSegments))
            map.overlays.addAll(dynamicOverlays)
            map.invalidate()
        }
    )
}

private fun arcgisSource(name: String, service: String, maxZoom: Int, copyright: String): ITileSource =
    object : OnlineTileSourceBase(
        name, 0, maxZoom, 256, ".jpg",
        arrayOf("https://server.arcgisonline.com/ArcGIS/rest/services/$service/MapServer/tile/"),
        copyright
    ) {
        // ArcGIS tiles are addressed z/row/column, the reverse of the usual z/x/y.
        override fun getTileURLString(pMapTileIndex: Long): String =
            baseUrl + MapTileIndex.getZoom(pMapTileIndex) + "/" + MapTileIndex.getY(pMapTileIndex) + "/" +
                MapTileIndex.getX(pMapTileIndex)
    }

private val SATELLITE_SOURCE = arcgisSource("EsriWorldImagery", "World_Imagery", 19, MapLayer.SATELLITE.attribution)
private val TOPO_SOURCE = arcgisSource("EsriWorldTopo", "World_Topo_Map", 19, MapLayer.TOPO.attribution)

private fun MapLayer.tileSource(): ITileSource = when (this) {
    MapLayer.SATELLITE -> SATELLITE_SOURCE
    MapLayer.STREET -> TileSourceFactory.MAPNIK
    MapLayer.TOPO -> TOPO_SOURCE
}

private val SORTIE_COLORS = intArrayOf(
    0xFFFF7043.toInt(), 0xFF00E5FF.toInt(), 0xFFE040FB.toInt(),
    0xFFC6FF00.toInt(), 0xFFFF1744.toInt(), 0xFF448AFF.toInt()
)

private val BOUNDARY_COLOR = 0xFF00E676.toInt()
private val TRACK_COLOR = 0xFFE040FB.toInt()
private val CORRECTION_COLOR = 0xFFFFEA00.toInt()
private val LOCATION_COLOR = 0xFF2979FF.toInt()
private val ZONE_OUTLINE = 0xFFFF1744.toInt()
private val ZONE_FILL = 0x66FF1744
private val DRAFT_COLOR = 0xFFFFA000.toInt()

/** The flown route split per sortie, so each tank load gets its own colour. Transit between flights is not drawn. */
private fun sortieSegments(plan: SprayPlan?): List<Pair<Int, List<GeoPoint>>> {
    if (plan == null) return emptyList()
    val out = ArrayList<Pair<Int, List<GeoPoint>>>()
    var sortie = Int.MIN_VALUE
    var current = ArrayList<GeoPoint>()
    for (wp in plan.waypoints()) {
        if (wp.sortie != sortie && current.isNotEmpty()) {
            out.add(sortie to current)
            current = ArrayList()
        }
        current.add(GeoPoint(wp.point.lat, wp.point.lng))
        sortie = wp.sortie
    }
    if (current.isNotEmpty()) out.add(sortie to current)
    return out
}

private fun geo(p: LatLng) = GeoPoint(p.lat, p.lng)

private fun closedRing(ring: List<LatLng>): List<GeoPoint> =
    if (ring.isNotEmpty() && ring.first() != ring.last()) (ring + ring.first()).map(::geo) else ring.map(::geo)

private fun buildOverlays(
    map: MapView,
    state: MapState,
    sortieSegments: List<Pair<Int, List<GeoPoint>>>
): List<Overlay> {
    val out = ArrayList<Overlay>()

    val field = state.field
    if (!field.isEmpty) {
        field.polygons.forEach { polygon ->
            polygon.rings().forEach { ring -> out.add(line(map, closedRing(ring), BOUNDARY_COLOR, 5f)) }
        }
    } else if (state.vertices.size >= 2) {
        out.add(line(map, state.vertices.map(::geo), BOUNDARY_COLOR, 5f))
    }
    if (!state.hasCorrections && state.zoneDraft == null) {
        state.vertices.forEach { out.add(dot(map, geo(it), BOUNDARY_COLOR, 10)) }
    }

    state.zones.forEach { out.add(zoneOverlay(map, it.polygon)) }
    state.zoneDraft?.let { draft ->
        if (draft.corners.size >= 2) {
            val points = if (draft.corners.size >= 3) closedRing(draft.corners) else draft.corners.map(::geo)
            out.add(line(map, points, DRAFT_COLOR, 5f))
        }
        draft.corners.forEach { out.add(dot(map, geo(it), DRAFT_COLOR, 10)) }
    }

    state.boundaryState.pendingCorrection?.let { preview ->
        out.add(line(map, closedRing(preview.correction.polygon.shell), CORRECTION_COLOR, 6f))
    }

    if (state.gpsState.trackedPoints.size >= 2) {
        out.add(line(map, state.gpsState.trackedPoints.map(::geo), TRACK_COLOR, 4f))
    }

    sortieSegments.forEach { (sortie, points) ->
        if (points.size >= 2) out.add(line(map, points, SORTIE_COLORS[Math.floorMod(sortie, SORTIE_COLORS.size)], 4f))
    }

    state.gpsState.currentLocation?.let { out.add(dot(map, geo(it), LOCATION_COLOR, 14)) }
    return out
}

/** A line that lets taps fall through to the map, so tracing next to an existing edge still adds a corner. */
private fun line(map: MapView, points: List<GeoPoint>, color: Int, width: Float): Polyline =
    Polyline(map).apply {
        setPoints(points)
        outlinePaint.color = color
        outlinePaint.strokeWidth = width
        infoWindow = null
        setOnClickListener { _, _, _ -> false }
    }

/** A translucent red area. It lets taps through, so a zone corner can be placed on top of an existing zone. */
private fun zoneOverlay(map: MapView, polygon: GeoPolygon): Polygon =
    Polygon(map).apply {
        points = closedRing(polygon.shell)
        holes = polygon.holes.map { closedRing(it) }
        fillPaint.color = ZONE_FILL
        outlinePaint.color = ZONE_OUTLINE
        outlinePaint.strokeWidth = 4f
        infoWindow = null
        setOnClickListener { _, _, _ -> false }
    }

/** A round marker with no pop-up. It swallows taps on itself, so tapping a corner never adds a duplicate. */
private fun dot(map: MapView, at: GeoPoint, color: Int, sizeDp: Int): Marker {
    val density = map.resources.displayMetrics.density
    val px = (sizeDp * density).toInt()
    val drawable = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(color)
        setStroke((2 * density).toInt(), AndroidColor.WHITE)
        setSize(px, px)
    }
    return Marker(map).apply {
        position = at
        icon = drawable
        setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
        setInfoWindow(null)
        setOnMarkerClickListener { _, _ -> true }
    }
}
