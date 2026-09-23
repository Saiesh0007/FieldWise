package com.fieldwise.map

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.fieldwise.gps.GpsPolicy
import kotlin.math.roundToInt

@Composable
fun GpsAccuracyBadge(
    accuracy: Double?,
    modifier: Modifier = Modifier
) {
    val (text, color) = when {
        accuracy == null -> "Acquiring GPS..." to Color.Yellow
        accuracy <= GpsPolicy.GOOD_M -> "Good (±${accuracy.roundToInt()}m)" to Color.Green
        accuracy <= GpsPolicy.FAIR_M -> "Fair (±${accuracy.roundToInt()}m)" to Color(0xFFFF9800)
        else -> "Poor (±${accuracy.roundToInt()}m)" to Color.Red
    }

    Card(
        modifier = modifier.padding(8.dp),
        colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.2f))
    ) {
        Text(
            text,
            modifier = Modifier.padding(8.dp),
            fontSize = MaterialTheme.typography.labelSmall.fontSize,
            color = color
        )
    }
}

@Composable
fun GpsWarning(accuracy: Double?) {
    GpsPolicy.advice(accuracy)?.let { warning ->
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEB3B).copy(alpha = 0.9f))
        ) {
            Text(
                warning,
                modifier = Modifier.padding(12.dp),
                fontSize = MaterialTheme.typography.labelSmall.fontSize,
                color = Color.Black
            )
        }
    }
}

/** Controls for a walk in progress. Starting a walk is done from the bottom bar; this only handles recording or paused. */
@Composable
fun GpsWalkControls(
    isPaused: Boolean,
    accuracy: Double?,
    trackPointCount: Int,
    trackLength: Double,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onFinish: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Color.Black.copy(alpha = 0.8f))
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    if (isPaused) "GPS walk paused" else "Recording GPS walk",
                    color = Color.White,
                    fontSize = MaterialTheme.typography.labelMedium.fontSize
                )
                Text(
                    "$trackPointCount points · ${trackLength.toInt()} m",
                    color = Color.LightGray,
                    fontSize = MaterialTheme.typography.labelSmall.fontSize
                )
            }
            GpsAccuracyBadge(accuracy)
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Button(
                onClick = onCancel,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Color.DarkGray)
            ) {
                Text("Cancel")
            }
            Button(
                onClick = if (isPaused) onResume else onPause,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFA500))
            ) {
                Text(if (isPaused) "Resume" else "Pause")
            }
            Button(
                onClick = onFinish,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4CAF50))
            ) {
                Text("Finish")
            }
        }

        GpsWarning(accuracy)
    }
}
