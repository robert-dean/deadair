package com.maroonedsoftware.deadair.ui.nowplaying

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.sdk.models.AirMode
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve

/** What the controls do. Each is fired and forgotten; the reading catches up through the poll. */
data class TransportHandlers(
    val onSkip: () -> Unit,
    val onStop: () -> Unit,
    val onStart: () -> Unit,
    val onHold: (minutes: Long?) -> Unit,
    val onRelease: () -> Unit,
    val onAirMode: (AirMode) -> Unit,
)

/**
 * The operator's transport, under the listener's play button.
 *
 * Skip and Stop side by side at equal widths, so "Confirm stop" cannot clip and Skip does not move
 * between the press that arms Stop and the press that fires it — the one moment on this screen
 * when nothing may move. Start takes Stop's place while the station is stood down. Under them, who
 * is driving and the hold, then what puts the station on air. Drawn only for a session the
 * station last called `admin`; the station still decides every press.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransportControls(state: TransportUiState, handlers: TransportHandlers, modifier: Modifier = Modifier) {
    val stop = rememberArmedStop(handlers.onStop)

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(onClick = handlers.onSkip, enabled = state.skipEnabled, modifier = Modifier.weight(1f).height(48.dp)) {
                Text(stringResource(R.string.skip))
            }
            if (state.showsStart) {
                Button(onClick = handlers.onStart, enabled = !state.busy, modifier = Modifier.weight(1f).height(48.dp)) {
                    Text(stringResource(R.string.start))
                }
            } else if (stop.armed) {
                // Filled once armed rather than outlined, so the state is legible at arm's length and not only in the word.
                Button(
                    onClick = stop::press,
                    enabled = !state.busy,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                    modifier = Modifier.weight(1f).height(48.dp),
                ) {
                    Text(stringResource(R.string.confirm_stop))
                }
            } else {
                OutlinedButton(
                    onClick = stop::press,
                    enabled = !state.busy,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.weight(1f).height(48.dp),
                ) {
                    Text(stringResource(R.string.stop))
                }
            }
        }

        state.driving?.let {
            Text(
                it.resolve(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            )
        }

        state.hold?.let { HoldLine(it, busy = state.busy, onHold = handlers.onHold, onRelease = handlers.onRelease) }

        state.airMode?.let { mode -> AirModeRow(mode, busy = state.busy, onAirMode = handlers.onAirMode) }
    }
}

/**
 * The state and the way out of it are the same control: a hold that cannot be SEEN is worse than no
 * hold. Each link says what it does to the sentence above it rather than naming the mechanism.
 */
@Composable
private fun HoldLine(hold: HoldUi, busy: Boolean, onHold: (Long?) -> Unit, onRelease: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        val line =
            when (hold) {
                HoldUi.Offered -> Message.ScheduleTakesThisBack
                HoldUi.HeldUntilReleased -> Message.HeldUntilReleased
                is HoldUi.HeldUntil -> Message.HeldUntilAbout(hold.clock)
            }
        Text(line.resolve(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
            if (hold is HoldUi.Offered) {
                TextButton(onClick = { onHold(null) }, enabled = !busy) { Text(stringResource(R.string.keep_on_past_next_block)) }
                TextButton(onClick = { onHold(TWO_HOURS) }, enabled = !busy) { Text(stringResource(R.string.keep_on_two_hours)) }
            } else {
                TextButton(onClick = onRelease, enabled = !busy) { Text(stringResource(R.string.release)) }
            }
        }
    }
}

/**
 * What the mount lease is renewed against: a station setting rather than a transport command, and
 * here because this is where somebody asks why nothing is going out.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AirModeRow(mode: AirMode, busy: Boolean, onAirMode: (AirMode) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(stringResource(R.string.air_mode_heading), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            AIR_MODES.forEachIndexed { index, (value, label) ->
                SegmentedButton(
                    selected = value == mode,
                    onClick = { if (value != mode) onAirMode(value) },
                    enabled = !busy,
                    shape = SegmentedButtonDefaults.itemShape(index = index, count = AIR_MODES.size),
                ) {
                    Text(stringResource(label), textAlign = TextAlign.Center)
                }
            }
        }
    }
}

private val AIR_MODES = listOf(AirMode.AUDIENCE to R.string.air_mode_audience, AirMode.ALWAYS to R.string.air_mode_always)

/** The console's second hold: long enough for a show, short enough that a forgotten one lapses tonight. */
private const val TWO_HOURS = 120L
