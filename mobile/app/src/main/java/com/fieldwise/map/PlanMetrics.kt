package com.fieldwise.map

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import com.fieldwise.model.SprayPlan
import kotlin.math.roundToInt

@Composable
fun PlanMetricsCard(
    plan: SprayPlan,
    onEdit: () -> Unit,
    onReview: () -> Unit,
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
                Text("Mission summary", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                TextButton(onClick = onEdit) { Text("Edit parameters") }
            }

            Button(
                onClick = onReview,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))
            ) { Text("Review and export") }

            Divider()

            Column(
                modifier = Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                MissionFigures(plan)
            }
        }
    }
}

/** The measured and estimated figures of a plan, shared by the summary card and the review screen. */
@Composable
internal fun MissionFigures(plan: SprayPlan) {
    val m = plan.metrics
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Section("Field")
        MetricRow("Total area", hectares(m.fieldAreaSqm))
        if (m.noSprayAreaSqm > 0.0) MetricRow("No-spray zones", hectares(m.noSprayAreaSqm))
        MetricRow("Sprayable area", hectares(m.sprayableAreaSqm))
        MetricRow("Covered (estimate)", hectares(m.coveredAreaSqm))
        MetricRow("Coverage (estimate)", "%.1f %%".format(m.coveragePercent))

        Section("Flight plan")
        MetricRow("Passes", "${plan.passes.size}")
        MetricRow("Flights (tank / battery)", "${plan.sorties.size}")
        MetricRow("Heading", "${plan.headingDeg.roundToInt()}°")
        MetricRow("Headings compared", "${plan.candidates.size}")

        Section("Distance and time")
        MetricRow("Spraying", "${m.sprayDistanceM.roundToInt()} m")
        MetricRow("Transit", "${m.transitDistanceM.roundToInt()} m")
        MetricRow("Total", "${m.totalDistanceM.roundToInt()} m")
        MetricRow("Flight time (estimate)", "%.1f min".format(m.flightTimeMin))

        Section("Chemical")
        MetricRow("Volume required (estimate)", "%.2f L".format(m.chemicalL))

        if (plan.notes.isNotEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE3F2FD))) {
                Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    plan.notes.forEach { note ->
                        Text("• $note", style = MaterialTheme.typography.bodySmall, color = Color.Black)
                    }
                }
            }
        }
    }
}

private fun hectares(sqm: Double): String = "%.2f ha".format(sqm / 10_000.0)

@Composable
private fun Section(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Bold,
        color = Color(0xFF2E7D32),
        modifier = Modifier.padding(top = 4.dp)
    )
}

@Composable
internal fun MetricRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
        Text(value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
    }
}
