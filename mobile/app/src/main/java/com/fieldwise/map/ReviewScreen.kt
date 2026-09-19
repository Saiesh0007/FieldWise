package com.fieldwise.map

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fieldwise.mission.ExportFormat
import com.fieldwise.mission.Safety
import com.fieldwise.mission.problemsOtherThanConfirmations
import com.fieldwise.model.Check
import com.fieldwise.model.CheckStatus
import java.text.DateFormat
import java.util.Date

private val GREEN = Color(0xFF2E7D32)
private val AMBER = Color(0xFFEF6C00)
private val RED = Color(0xFFC62828)

/**
 * Pre-flight review: the measured figures, every validation check, the pilot's three confirmations and export.
 * Export stays locked until the mission is validated and the pilot has confirmed it.
 */
@Composable
fun ReviewScreen(state: MapState, actions: MapActions) {
    val plan = state.sprayState.plan ?: return
    val nowMs = remember(plan, state.zones, state.confirmations) { System.currentTimeMillis() }
    val report = remember(plan, state.zones, state.confirmations, state.boundaryState.history) { state.validation(nowMs) } ?: return

    val boundaryConfirmed = state.confirmations.boundaryAt != null
    val parametersConfirmed = state.confirmations.parametersAt != null
    val problems = report.problemsOtherThanConfirmations()
    val missionConfirmed = state.confirmations.missionAt != null && report.canExport

    Surface(modifier = Modifier.fillMaxSize(), color = Color(0xFFF4F7F2)) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF1B5E20))
                    .statusBarsPadding()
                    .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Pre-flight review",
                    color = Color.White,
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.weight(1f)
                )
                TextButton(onClick = actions.onCloseReview) { Text("Close", color = Color.White) }
            }

            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                StatusBanner(missionConfirmed = missionConfirmed, problemCount = problems.size)

                SectionCard("Mission summary") { MissionFigures(plan) }

                SectionCard("Checks") {
                    report.checks.forEach { CheckRow(it) }
                }

                SectionCard("Your confirmation") {
                    Text(
                        "Nothing is exported until you confirm all three. Changing the field, a zone or a parameter withdraws them.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.DarkGray
                    )
                    ConfirmRow(
                        checked = boundaryConfirmed,
                        text = "I have compared the corrected boundary with the real field.",
                        onChange = actions.onConfirmBoundary
                    )
                    ConfirmRow(
                        checked = parametersConfirmed,
                        text = "I confirm the spray parameters: width, overlap, speed, altitude and rate.",
                        onChange = actions.onConfirmParameters
                    )
                    Button(
                        onClick = actions.onConfirmMission,
                        enabled = boundaryConfirmed && parametersConfirmed && problems.isEmpty() && !missionConfirmed,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = GREEN)
                    ) { Text(if (missionConfirmed) "Final mission confirmed" else "Confirm final mission") }
                    if (problems.isNotEmpty()) {
                        Text(
                            "Fix the failed checks above before you can confirm.",
                            style = MaterialTheme.typography.bodySmall,
                            color = RED
                        )
                    }
                }

                SectionCard("Export") {
                    ExportFormat.values().forEach { format ->
                        Button(
                            onClick = { actions.onExport(format) },
                            enabled = missionConfirmed,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1976D2))
                        ) { Text("Share ${format.label}") }
                    }
                    Text(
                        if (missionConfirmed) {
                            "Files are handed to the app you pick in Android's share sheet."
                        } else {
                            "Export unlocks after you confirm the final mission."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.DarkGray
                    )
                    state.exports.forEach {
                        Text(
                            "${it.format} shared at ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it.at))}",
                            style = MaterialTheme.typography.bodySmall,
                            color = GREEN
                        )
                    }
                }

                Text(Safety.DISCLAIMER, style = MaterialTheme.typography.bodySmall, color = Color.DarkGray)
                Spacer(modifier = Modifier.navigationBarsPadding())
            }
        }
    }
}

@Composable
private fun StatusBanner(missionConfirmed: Boolean, problemCount: Int) {
    val (color, text) = when {
        missionConfirmed -> GREEN to "Mission confirmed. It can be exported."
        problemCount == 0 -> AMBER to "The checks passed. Confirm below to unlock export."
        else -> RED to "$problemCount check(s) failed. Fix them before export."
    }
    Card(colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.12f))) {
        Text(
            text,
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            color = color,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

@Composable
private fun CheckRow(check: Check) {
    val (icon, color) = when (check.status) {
        CheckStatus.PASS -> Icons.Default.CheckCircle to GREEN
        CheckStatus.WARN -> Icons.Default.Warning to AMBER
        CheckStatus.FAIL -> Icons.Default.Close to RED
    }
    Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
        Icon(icon, contentDescription = check.status.name, tint = color, modifier = Modifier.size(20.dp))
        Column(modifier = Modifier.padding(start = 8.dp)) {
            Text(check.label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            if (check.detail != null) {
                Text(check.detail, style = MaterialTheme.typography.bodySmall, color = if (check.status == CheckStatus.PASS) Color.Gray else color)
            }
        }
    }
}

@Composable
private fun ConfirmRow(checked: Boolean, text: String, onChange: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onChange(!checked) }
    ) {
        Checkbox(checked = checked, onCheckedChange = onChange)
        Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 4.dp))
    }
}
