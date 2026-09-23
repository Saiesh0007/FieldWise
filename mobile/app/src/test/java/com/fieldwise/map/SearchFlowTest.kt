package com.fieldwise.map

import com.fieldwise.TestMissions
import com.fieldwise.model.LatLng
import com.fieldwise.search.PlaceResult
import com.fieldwise.search.SearchOutcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Finding a place other than the pilot's own: what the search box does with coordinates, names and failures. */
class SearchFlowTest {
    private val pune = PlaceResult("Pune, Maharashtra, India", LatLng(18.5204, 73.8567), 15.0)
    private val khed = PlaceResult("Khed Shivapur, Maharashtra, India", LatLng(18.3, 73.9), 15.0)

    private fun typed(text: String) = MapState().withSearchQuery(text)

    @Test
    fun `coordinates jump at once, offline, and mark the spot`() {
        val state = typed("18.5204, 73.8567").submitSearch()
        assertFalse(state.search.searching)
        assertEquals(18.5204, state.search.pin!!.point.lat, 1e-9)
        assertEquals(73.8567, state.search.pin!!.point.lng, 1e-9)
        assertEquals(COORDINATE_ZOOM, state.focus!!.zoom, 0.0)
        assertEquals(1, state.focus!!.id)
        assertEquals("18.52040, 73.85670", state.search.query)
    }

    @Test
    fun `each new place moves the map again even if it is the same place`() {
        val first = typed("18.5204, 73.8567").submitSearch()
        val again = first.withSearchQuery("18.5204, 73.8567").submitSearch()
        assertEquals(2, again.focus!!.id)
    }

    @Test
    fun `a Google Maps link is read the same way`() {
        val state = typed("https://www.google.com/maps/@19.1,74.2,17z").submitSearch()
        assertEquals(19.1, state.focus!!.point.lat, 1e-9)
        assertEquals(74.2, state.focus!!.point.lng, 1e-9)
    }

    @Test
    fun `a place name starts a lookup and does not move the map yet`() {
        val state = typed("Pune").submitSearch()
        assertTrue(state.search.searching)
        assertNull(state.focus)
        assertNull(state.search.pin)
    }

    @Test
    fun `a single match is chosen automatically`() {
        val state = typed("Pune").submitSearch().withSearchOutcome(SearchOutcome.Found(listOf(pune)), "Pune")
        assertFalse(state.search.searching)
        assertEquals(pune, state.search.pin)
        assertEquals(pune.point, state.focus!!.point)
        assertEquals(15.0, state.focus!!.zoom, 0.0)
    }

    @Test
    fun `several matches are listed, at most five, until one is picked`() {
        val many = (1..8).map { PlaceResult("Khed $it", LatLng(18.0 + it / 100.0, 73.0), 15.0) }
        val listed = typed("Khed").submitSearch().withSearchOutcome(SearchOutcome.Found(many), "Khed")
        assertEquals(5, listed.search.results.size)
        assertNull(listed.focus)

        val picked = listed.choosePlace(listed.search.results[2])
        assertEquals(many[2].point, picked.focus!!.point)
        assertTrue(picked.search.results.isEmpty())
        assertEquals(many[2], picked.search.pin)
    }

    @Test
    fun `no match and a failed lookup each explain themselves`() {
        val none = typed("Xyzzyville").submitSearch().withSearchOutcome(SearchOutcome.NotFound, "Xyzzyville")
        assertFalse(none.search.searching)
        assertTrue(none.search.message!!.contains("Xyzzyville"))
        assertNull(none.focus)

        val offline = typed("Pune").submitSearch().withSearchOutcome(SearchOutcome.Failed("No connection."), "Pune")
        assertFalse(offline.search.searching)
        assertEquals("No connection.", offline.search.message)
    }

    @Test
    fun `an answer that arrives after the text changed is ignored`() {
        val submitted = typed("Pune").submitSearch()
        val edited = submitted.withSearchQuery("Khed")
        val late = edited.withSearchOutcome(SearchOutcome.Found(listOf(pune)), "Pune")
        assertNull(late.focus)
        assertNull(late.search.pin)
        assertEquals("Khed", late.search.query)
    }

    @Test
    fun `an answer that arrives after the search was cleared is ignored`() {
        val late = typed("Pune").submitSearch().clearSearch().withSearchOutcome(SearchOutcome.Found(listOf(pune)), "Pune")
        assertNull(late.focus)
        assertEquals("", late.search.query)
    }

    @Test
    fun `impossible coordinates give a message and do not move the map`() {
        val state = typed("95, 200").submitSearch()
        assertNull(state.focus)
        assertFalse(state.search.searching)
        assertTrue(state.search.message!!.contains("Latitude"))
    }

    @Test
    fun `an empty search, or one already running, does nothing`() {
        val blank = typed("   ")
        assertEquals(blank, blank.submitSearch())
        val running = typed("Pune").submitSearch()
        assertEquals(running, running.submitSearch())
    }

    @Test
    fun `clearing the search removes the text and the marked place`() {
        val cleared = typed("18.5204, 73.8567").submitSearch().clearSearch()
        assertEquals("", cleared.search.query)
        assertNull(cleared.search.pin)
    }

    @Test
    fun `going to my location needs a known position`() {
        val unknown = MapState().goToMyLocation()
        assertNull(unknown.focus)
        assertNotNull(unknown.notice)

        val known = MapState(gpsState = GpsState(currentLocation = LatLng(19.0, 74.0))).goToMyLocation()
        assertEquals(LatLng(19.0, 74.0), known.focus!!.point)
        assertEquals(MY_LOCATION_ZOOM, known.focus!!.zoom, 0.0)
    }

    @Test
    fun `searching never touches the field, so nothing is saved or invalidated`() {
        val planned = TestMissions.planned(TestMissions.field())
        val searched = planned.withSearchQuery("18.6, 73.9").submitSearch()
        assertEquals(planned.persistKey(), searched.persistKey())
        assertNotNull(searched.sprayState.plan)
        assertEquals(planned.field, searched.field)
    }

    @Test
    fun `resetting the field keeps the searched place`() {
        val state = TestMissions.field().withSearchQuery("18.6, 73.9").submitSearch().cleared()
        assertNotNull(state.search.pin)
        assertNotNull(state.focus)
    }

    @Test
    fun `a lookup can still be started after the previous one finished`() {
        val first = typed("Pune").submitSearch().withSearchOutcome(SearchOutcome.NotFound, "Pune")
        val second = first.withSearchQuery("Khed").submitSearch()
        assertTrue(second.search.searching)
        val done = second.withSearchOutcome(SearchOutcome.Found(listOf(khed)), "Khed")
        assertEquals(khed, done.search.pin)
    }
}
