package com.fieldwise.map

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Looper
import androidx.core.content.ContextCompat
import com.fieldwise.gps.FixOutcome
import com.fieldwise.gps.GpsCapture
import com.fieldwise.gps.GpsFix
import com.fieldwise.gps.GpsWalkSession
import com.fieldwise.model.LatLng
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class GpsState(
    val currentLocation: LatLng? = null,
    val currentAccuracy: Double? = null,
    /** True only while a walk is actively recording; false when idle or paused. */
    val isTracking: Boolean = false,
    val walkSession: GpsWalkSession = GpsWalkSession(),
    val trackedPoints: List<LatLng> = emptyList()
) {
    val isWalking: Boolean
        get() = walkSession.state == GpsWalkSession.State.RECORDING || walkSession.state == GpsWalkSession.State.PAUSED
    val isPaused: Boolean get() = walkSession.state == GpsWalkSession.State.PAUSED
}

class GpsController(private val context: Context) {
    private val fusedLocationClient = LocationServices.getFusedLocationProviderClient(context)
    private val _gpsState = MutableStateFlow(GpsState())
    val gpsState: StateFlow<GpsState> = _gpsState

    private var locationCallback: LocationCallback? = null
    private val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L)
        .setMinUpdateIntervalMillis(500L)
        .build()

    /** Returns false when the walk could not start (no precise-location permission, or one is already running). */
    fun startTracking(): Boolean {
        if (!hasLocationPermission() || _gpsState.value.isWalking) return false

        val session = GpsWalkSession()
        session.start(System.currentTimeMillis())
        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                for (location in result.locations) {
                    val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else Double.MAX_VALUE
                    onFix(session, GpsFix(LatLng(location.latitude, location.longitude), accuracy, System.currentTimeMillis()))
                }
            }
        }
        try {
            fusedLocationClient.requestLocationUpdates(locationRequest, callback, Looper.getMainLooper())
        } catch (e: SecurityException) {
            return false
        }
        locationCallback = callback
        _gpsState.value = _gpsState.value.copy(isTracking = true, walkSession = session, trackedPoints = emptyList())
        return true
    }

    private fun onFix(session: GpsWalkSession, fix: GpsFix) {
        val current = _gpsState.value
        // A stale callback from a walk that has since been cancelled must not touch the new state.
        if (current.walkSession !== session) return
        when (session.onFix(fix)) {
            FixOutcome.ACCEPTED -> _gpsState.value = current.copy(
                currentLocation = fix.point,
                currentAccuracy = fix.accuracyM,
                trackedPoints = current.trackedPoints + fix.point
            )
            // Keep the dot moving while paused or standing still, but never add it to the track.
            FixOutcome.IGNORED -> _gpsState.value = current.copy(currentLocation = fix.point, currentAccuracy = fix.accuracyM)
            FixOutcome.DROPPED_POOR_ACCURACY -> _gpsState.value = current.copy(currentAccuracy = fix.accuracyM)
        }
    }

    fun pauseTracking() {
        val current = _gpsState.value
        if (current.walkSession.state != GpsWalkSession.State.RECORDING) return
        current.walkSession.pause()
        _gpsState.value = current.copy(isTracking = false)
    }

    fun resumeTracking() {
        val current = _gpsState.value
        if (current.walkSession.state != GpsWalkSession.State.PAUSED) return
        current.walkSession.resume()
        _gpsState.value = current.copy(isTracking = true)
    }

    /** Ends the walk, from either recording or paused, and returns what was captured. */
    fun finishTracking(): GpsCapture? {
        val current = _gpsState.value
        if (!current.isWalking) return null
        val capture = current.walkSession.finish(System.currentTimeMillis())
        removeUpdates()
        _gpsState.value = current.copy(isTracking = false)
        return capture
    }

    /** Stops location updates and discards the walk, keeping only the last known position. */
    fun stopAllTracking() {
        removeUpdates()
        val current = _gpsState.value
        _gpsState.value = GpsState(currentLocation = current.currentLocation, currentAccuracy = current.currentAccuracy)
    }

    private fun removeUpdates() {
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        locationCallback = null
    }

    fun getLastKnownLocation() {
        if (!hasLocationPermission()) return
        try {
            fusedLocationClient.lastLocation.addOnSuccessListener { location: android.location.Location? ->
                location?.let {
                    _gpsState.value = _gpsState.value.copy(
                        currentLocation = LatLng(it.latitude, it.longitude),
                        currentAccuracy = if (it.hasAccuracy()) it.accuracy.toDouble() else null
                    )
                }
            }
        } catch (e: SecurityException) {
            // Permission was revoked between the check and the call; there is nothing to show.
        }
    }

    fun hasLocationPermission(): Boolean = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_FINE_LOCATION
    ) == PackageManager.PERMISSION_GRANTED
}
