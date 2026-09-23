package com.fieldwise.ui.simulation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fieldwise.drone.SimulationState
import com.fieldwise.drone.SimulationStatus
import com.fieldwise.map.FieldMap
import com.fieldwise.map.MapState
import com.fieldwise.model.LatLng

@Composable
fun SimulatorScreen(
    mapState: MapState,
    simulationState: SimulationState,
    onStart: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onRestart: () -> Unit,
    onStop: () -> Unit,
    onMissionComplete: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(modifier = modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Top bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF1B5E20))
                    .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Mission Simulation",
                    style = MaterialTheme.typography.titleLarge,
                    color = Color.White,
                    fontWeight = FontWeight.Bold
                )
                TextButton(onClick = onStop) {
                    Text("Stop", color = Color.White)
                }
            }

            // Map with drone position
            FieldMap(
                state = mapState,
                onTap = { },
                dronePosition = if (simulationState.status != SimulationStatus.IDLE) simulationState.position else null,
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(0.55f)
            )

            // Telemetry panel
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight()
                    .verticalScroll(rememberScrollState())
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Uploading mission
                if (simulationState.status == SimulationStatus.IDLE && simulationState.progressPercent == 0) {
                    Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.height(24.dp)
                            )
                            Text("Preparing flight plan...", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }

                Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        // Progress bar
                        Text("Progress", style = MaterialTheme.typography.labelSmall)
                        LinearProgressIndicator(
                            progress = simulationState.progressPercent / 100f,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Text(
                            "${simulationState.progressPercent}%",
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Bold
                        )

                        // Live metrics
                        TelemetryRow("Distance", "${simulationState.distanceFlownM.toInt()} m")
                        TelemetryRow("Elapsed", "${(simulationState.elapsedSecondsSinceStart / 60).toInt()} min")
                        TelemetryRow("Battery", "${simulationState.batteryPercent.toInt()}%")
                        TelemetryRow("Spray Used", "${String.format("%.1f", simulationState.sprayUsedL)} L")
                        TelemetryRow("Flight", "${simulationState.currentSortie + 1}")
                    }
                }

                // Status text
                Text(
                    when (simulationState.status) {
                        SimulationStatus.IDLE -> "Ready to start"
                        SimulationStatus.RUNNING -> "Flying..."
                        SimulationStatus.PAUSED -> "Paused"
                        SimulationStatus.COMPLETED -> "Mission complete"
                    },
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = when (simulationState.status) {
                        SimulationStatus.COMPLETED -> Color(0xFF2E7D32)
                        else -> Color.Black
                    }
                )

                // Controls
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    when (simulationState.status) {
                        SimulationStatus.IDLE -> {
                            Button(
                                onClick = onStart,
                                modifier = Modifier
                                    .weight(1f)
                                    .height(40.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))
                            ) {
                                Text("Start", style = MaterialTheme.typography.labelSmall)
                            }
                        }

                        SimulationStatus.RUNNING -> {
                            Button(
                                onClick = onPause,
                                modifier = Modifier
                                    .weight(1f)
                                    .height(40.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFA500))
                            ) {
                                Text("Pause", style = MaterialTheme.typography.labelSmall)
                            }
                        }

                        SimulationStatus.PAUSED -> {
                            Button(
                                onClick = onResume,
                                modifier = Modifier
                                    .weight(1f)
                                    .height(40.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0097A7))
                            ) {
                                Text("Resume", style = MaterialTheme.typography.labelSmall)
                            }
                        }

                        SimulationStatus.COMPLETED -> {
                            Button(
                                onClick = onMissionComplete,
                                modifier = Modifier
                                    .weight(1f)
                                    .height(40.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))
                            ) {
                                Text("Complete", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }

                    if (simulationState.status != SimulationStatus.IDLE) {
                        Button(
                            onClick = onRestart,
                            modifier = Modifier
                                .weight(1f)
                                .height(40.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color.Gray)
                        ) {
                            Text("Restart", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TelemetryRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
        Text(value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
    }
}
