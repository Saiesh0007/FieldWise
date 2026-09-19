package com.fieldwise.map

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.fieldwise.correction.TrackCorrection
import com.fieldwise.model.LatLng
import kotlin.math.roundToInt

data class CorrectionPreview(
    val correction: TrackCorrection,
    val kind: String,
    val method: String,
    val area: Double,
    val warnings: List<String>
)

@Composable
fun CorrectionPreviewCard(
    preview: CorrectionPreview,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(8.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White.copy(alpha = 0.95f))
    ) {
        Column(
            modifier = Modifier
                .padding(12.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "GPS Correction Ready",
                    fontSize = MaterialTheme.typography.headlineSmall.fontSize,
                    fontWeight = androidx.compose.ui.text.font.FontWeight.Bold
                )
                Text(
                    preview.kind,
                    fontSize = MaterialTheme.typography.labelSmall.fontSize,
                    color = if (preview.kind == "ADD") Color.Green else Color.Red
                )
            }

            Divider()

            // Stats
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                StatRow("Method", preview.method)
                StatRow("Area", "${preview.area.roundToInt()} m²")
                StatRow("GPS Fixes", "${preview.correction.stats.fixCount} (${preview.correction.stats.droppedFixes} dropped)")
                StatRow("Track Length", "${preview.correction.stats.lengthMeters.toInt()} m")
                StatRow("Accuracy", "±${preview.correction.stats.meanAccuracyM.roundToInt()} m (mean)")
            }

            // Warnings
            if (preview.warnings.isNotEmpty()) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEB3B).copy(alpha = 0.2f))
                ) {
                    Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            "⚠ Warnings",
                            fontSize = MaterialTheme.typography.labelSmall.fontSize,
                            fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                            color = Color(0xFFFFA000)
                        )
                        preview.warnings.forEach { warning ->
                            Text(
                                "• $warning",
                                fontSize = MaterialTheme.typography.labelSmall.fontSize,
                                color = Color.Black
                            )
                        }
                    }
                }
            }

            // Action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onReject,
                    modifier = Modifier
                        .weight(1f)
                        .height(40.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD32F2F))
                ) {
                    Icon(Icons.Default.Close, "Reject", modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Reject", fontSize = MaterialTheme.typography.labelSmall.fontSize)
                }

                Button(
                    onClick = onAccept,
                    modifier = Modifier
                        .weight(1f)
                        .height(40.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4CAF50))
                ) {
                    Icon(Icons.Default.CheckCircle, "Accept", modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Accept", fontSize = MaterialTheme.typography.labelSmall.fontSize)
                }
            }

            Text(
                "The map shows the correction in yellow. Accept to merge it into your boundary.",
                fontSize = MaterialTheme.typography.labelSmall.fontSize,
                color = Color.Gray,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

@Composable
private fun StatRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            label,
            fontSize = MaterialTheme.typography.labelSmall.fontSize,
            color = Color.Gray
        )
        Text(
            value,
            fontSize = MaterialTheme.typography.labelSmall.fontSize,
            fontWeight = androidx.compose.ui.text.font.FontWeight.Bold
        )
    }
}
