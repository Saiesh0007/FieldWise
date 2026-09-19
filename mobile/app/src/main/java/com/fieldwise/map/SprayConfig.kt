package com.fieldwise.map

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fieldwise.model.NoSprayZone
import com.fieldwise.model.SprayConfig

@Composable
fun SprayConfigControls(
    config: SprayConfig,
    zones: List<NoSprayZone>,
    error: String?,
    planning: Boolean,
    onConfigChange: (SprayConfig) -> Unit,
    onGeneratePlan: () -> Unit,
    onAddZone: () -> Unit,
    onRemoveZone: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(8.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White.copy(alpha = 0.95f))
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Spray parameters", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Button(
                    onClick = onGeneratePlan,
                    enabled = !planning,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))
                ) {
                    if (planning) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                    } else {
                        Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(if (planning) "Planning..." else "Generate path")
                }
            }

            if (error != null) {
                Text(error, color = Color(0xFFB00020), style = MaterialTheme.typography.bodySmall)
            }

            Divider()

            Column(
                modifier = Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                ConfigSlider("Swath width", config.swathWidthM, 2.0..10.0, 0.5, "m") {
                    onConfigChange(config.copy(swathWidthM = it))
                }
                ConfigSlider("Overlap", config.overlapPercent, 0.0..50.0, 1.0, "%") {
                    onConfigChange(config.copy(overlapPercent = it))
                }
                ConfigSlider("Flight speed", config.speedMps, 1.0..8.0, 0.5, "m/s") {
                    onConfigChange(config.copy(speedMps = it))
                }
                ConfigSlider("Altitude", config.altitudeM, 1.0..50.0, 1.0, "m") {
                    onConfigChange(config.copy(altitudeM = it))
                }
                Divider()
                ZonesSection(zones = zones, onAddZone = onAddZone, onRemoveZone = onRemoveZone)
            }
        }
    }
}

@Composable
private fun ConfigSlider(
    label: String,
    value: Double,
    range: ClosedFloatingPointRange<Double>,
    step: Double,
    unit: String,
    onValueChange: (Double) -> Unit
) {
    Column {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = Color.Gray)
            Text("%.1f %s".format(value, unit), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        }
        Slider(
            value = value.coerceIn(range).toFloat(),
            onValueChange = { onValueChange(it.toDouble()) },
            valueRange = range.start.toFloat()..range.endInclusive.toFloat(),
            steps = ((range.endInclusive - range.start) / step).toInt() - 1
        )
    }
}
