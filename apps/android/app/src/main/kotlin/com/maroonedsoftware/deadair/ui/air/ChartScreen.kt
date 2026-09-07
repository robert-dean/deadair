package com.maroonedsoftware.deadair.ui.air

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.sdk.models.ChartPage
import com.maroonedsoftware.deadair.sdk.models.PlayoutChartInputChartOrder
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.catalog.DetailScaffold
import com.maroonedsoftware.deadair.ui.catalog.detailFailure
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve

/**
 * A published chart: its records, ranked, which way round to play them, and the button.
 *
 * What a chart costs that a playlist does not is said under the button rather than left to be
 * heard: a chart names records rather than copies, so the station looks each one up and ingests
 * it, and those arrive unmeasured and air untrimmed until the analysis pass reaches them.
 */
@Composable
fun ChartScreen(
    title: String,
    state: LoadState<ChartPage>,
    busy: Boolean,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    /** This page puts something on air, so it says what the station answered. */
    snackbarHost: SnackbarHostState,
    onAir: (PlayoutChartInputChartOrder) -> Unit,
) {
    var order by rememberSaveable { mutableStateOf(PlayoutChartInputChartOrder.COUNTDOWN) }
    var confirming by rememberSaveable { mutableStateOf(false) }

    DetailScaffold(
        title = title,
        state = state,
        onBack = onBack,
        onRetry = onRetry,
        snackbarHost = snackbarHost,
        failureText = { status -> detailFailure(status, R.string.chart_unavailable) },
    ) { chart ->
        if (chart.records.isEmpty()) {
            Text(stringResource(R.string.chart_empty), style = MaterialTheme.typography.bodyMedium)
            return@DetailScaffold
        }

        Text(stringResource(R.string.chart_order_heading), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(modifier = Modifier.fillMaxWidth().selectableGroup()) {
            CHART_ORDERS.forEach { candidate ->
                Row(
                    modifier =
                        Modifier.fillMaxWidth()
                            .selectable(selected = candidate == order, role = Role.RadioButton, onClick = { order = candidate })
                            .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = candidate == order, onClick = null)
                    Text(Message.ChartOrder(candidate).resolve(), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 12.dp))
                }
            }
        }

        Button(onClick = { confirming = true }, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Text(stringResource(R.string.air_this_chart))
        }
        Text(
            stringResource(R.string.chart_caveat),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )

        Column(modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
            chart.records.forEachIndexed { index, record ->
                ListItem(
                    leadingContent = {
                        Text(record.rank.toString(), style = MaterialTheme.typography.titleMedium, modifier = Modifier.width(36.dp))
                    },
                    headlineContent = { Text(record.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    supportingContent = {
                        val credit = (listOf(record.artist) + record.featuring.orEmpty()).joinToString(", ")
                        val stats =
                            listOfNotNull(
                                record.peak?.let { stringResource(R.string.chart_peak, it) },
                                record.weeksOn?.toInt()?.let { pluralStringResource(R.plurals.chart_weeks, it, it) },
                            )
                        Text((listOf(credit) + stats).joinToString(" · "), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    },
                )
                if (index < chart.records.lastIndex) HorizontalDivider()
            }
        }
    }

    if (confirming) {
        ConfirmAir(
            what = title,
            onConfirm = {
                confirming = false
                onAir(order)
            },
            onDismiss = { confirming = false },
        )
    }
}
