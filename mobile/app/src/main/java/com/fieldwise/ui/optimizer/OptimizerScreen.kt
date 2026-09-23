package com.fieldwise.ui.optimizer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fieldwise.map.FieldMap
import com.fieldwise.map.MapActions
import com.fieldwise.map.MapState
import com.fieldwise.model.CandidateResult
import com.fieldwise.model.SprayPlan

@Composable
fun OptimizerScreen(
    mapState: MapState,
    mapActions: MapActions,
    onSimulate: () -> Unit,
    onOpenReview: () -> Unit,
    onCompare: () -> Unit,
    onClearComparison: () -> Unit,
    comparisonPlan: com.fieldwise.model.SprayPlan? = null,
    modifier: Modifier = Modifier
) {
    val plan = mapState.sprayState.plan
    val metrics = plan?.metrics
    val comparisonMetrics = comparisonPlan?.metrics
    val isPlanning = mapState.sprayState.planning

    Box(modifier = modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Top bar with title and close
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF1B5E20))
                    .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Mission Optimizer",
                    style = MaterialTheme.typography.titleLarge,
                    color = Color.White,
                    fontWeight = FontWeight.Bold
                )
                TextButton(onClick = { /* handled by navigation */ }) {
                    Text("Back", color = Color.White)
                }
            }

            // Map with optional comparison plan
            FieldMap(
                state = mapState,
                onTap = mapActions.onAddVertex,
                comparisonPlan = comparisonPlan,
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(0.5f)
            )

            // Bottom panel: metrics and controls
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight()
                    .verticalScroll(rememberScrollState())
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Planning in progress
                if (isPlanning) {
                    Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            CircularProgressIndicator(modifier = Modifier.weight(0f))
                            Text("Optimizing path...", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }

                // Angle optimization card
                if (plan != null) {
                    AngleOptimizationCard(candidates = plan.candidates)
                }

                // Metrics summary
                if (metrics != null) {
                    Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Optimized Route", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Color(0xFF2E7D32))
                            MetricRow("Distance", "${metrics.totalDistanceM.toInt()} m")
                            MetricRow("Time (est.)", "${metrics.flightTimeMin.toInt()} min")
                            MetricRow("Spray (est.)", "${String.format("%.1f", metrics.chemicalL)} L")
                            MetricRow("Coverage", "${String.format("%.1f", metrics.coveragePercent)}%")
                        }
                    }
                }

                // Comparison metrics
                if (comparisonMetrics != null) {
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3E0))) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Standard Route (0°)", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                                TextButton(onClick = onClearComparison) {
                                    Text("Clear", style = MaterialTheme.typography.labelSmall)
                                }
                            }
                            MetricRow("Distance", "${comparisonMetrics.totalDistanceM.toInt()} m")
                            MetricRow("Time (est.)", "${comparisonMetrics.flightTimeMin.toInt()} min")
                            MetricRow("Spray (est.)", "${String.format("%.1f", comparisonMetrics.chemicalL)} L")
                            MetricRow("Coverage", "${String.format("%.1f", comparisonMetrics.coveragePercent)}%")

                            val distanceSaved = comparisonMetrics.totalDistanceM - metrics!!.totalDistanceM
                            if (distanceSaved > 0) {
                                Text(
                                    "Optimized route saves ${distanceSaved.toInt()} m",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Color(0xFF2E7D32),
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }

                // Controls
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Button(
                        onClick = { mapActions.onGenerateSprayPlan() },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))
                    ) {
                        Text("Generate")
                    }
                    Button(
                        onClick = onCompare,
                        enabled = plan != null && comparisonPlan == null,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFA500))
                    ) {
                        Text("Compare")
                    }
                    Button(
                        onClick = onSimulate,
                        enabled = plan != null,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1976D2))
                    ) {
                        Text("Simulate")
                    }
                }

                // Secondary controls
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = onOpenReview,
                        enabled = plan != null,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0097A7))
                    ) {
                        Text("Review")
                    }
                }
            }
        }
    }
}

@Composable
private fun AngleOptimizationCard(candidates: List<CandidateResult>, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White)
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Path Optimization", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Text("${candidates.size} angles tested", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            Divider()
            candidates.sortedBy { it.cost }.take(7).forEach { candidate ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("${candidate.angleDeg.toInt()}°", style = MaterialTheme.typography.bodySmall)
                    Text(
                        "${candidate.sprayDistanceM.toInt()} m · ${candidate.turns} turns",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (candidate.chosen) Color(0xFF2E7D32) else Color.Gray,
                        fontWeight = if (candidate.chosen) FontWeight.Bold else FontWeight.Normal
                    )
                }
            }
            if (candidates.any { it.chosen }) {
                val chosen = candidates.first { it.chosen }
                Text(
                    "Optimal: ${chosen.angleDeg.toInt()}°",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF2E7D32),
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}

@Composable
private fun MetricRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
        Text(value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
    }
}
