package com.maroonedsoftware.deadair.ui.nowplaying

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
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
 * Skip and Take off air side by side at equal widths, so the armed label cannot clip and Skip does
 * not move between the press that arms and the press that fires — the one moment on the screen when
 * nothing may move. Start takes the second place while the station is stood down.
 *
 * Named by what it stops: the round button on Now playing stops this phone, and both were "Stop",
 * to a thumb and to TalkBack. Armed, it fills and drains a bar along its foot, so the five seconds
 * it waits are seen rather than guessed at; when the bar empties it is Take off air again.
 */
@Composable
fun TransportPair(state: TransportUiState, handlers: TransportHandlers, modifier: Modifier = Modifier) {
    val stop = rememberArmedStop(handlers.onStop)

    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = modifier.fillMaxWidth()) {
        OutlinedButton(onClick = handlers.onSkip, enabled = state.skipEnabled, modifier = Modifier.weight(1f).height(48.dp)) {
            Text(stringResource(R.string.skip))
        }
        if (state.showsStart) {
            Button(onClick = handlers.onStart, enabled = !state.busy, modifier = Modifier.weight(1f).height(48.dp)) {
                Text(stringResource(R.string.start))
            }
        } else if (stop.armed) {
            val drain = remember { Animatable(1f) }
            LaunchedEffect(Unit) { drain.animateTo(0f, tween(durationMillis = STOP_ARMED_MS.toInt(), easing = LinearEasing)) }
            val bar = MaterialTheme.colorScheme.onErrorContainer
            // Filled once armed rather than outlined, so the state is legible at arm's length and not only in the word.
            Button(
                onClick = stop::press,
                enabled = !state.busy,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.errorContainer, contentColor = MaterialTheme.colorScheme.onErrorContainer),
                contentPadding = PaddingValues(horizontal = 12.dp),
                modifier =
                    Modifier.weight(1f).height(48.dp).drawWithContent {
                        drawContent()
                        val height = 3.dp.toPx()
                        drawRect(bar, topLeft = Offset(0f, size.height - height), size = Size(size.width * drain.value, height))
                    },
            ) {
                Text(stringResource(R.string.confirm_take_off_air), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        } else {
            OutlinedButton(
                onClick = stop::press,
                enabled = !state.busy,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                border = BorderStroke(1.dp, if (state.busy) MaterialTheme.colorScheme.outlineVariant else MaterialTheme.colorScheme.error),
                modifier = Modifier.weight(1f).height(48.dp),
            ) {
                Text(stringResource(R.string.take_off_air))
            }
        }
    }
}

/**
 * The state and the way out of it are the same control: a hold that cannot be SEEN is worse than no
 * hold. Each link says what it does to the sentence above it rather than naming the mechanism.
 */
@Composable
fun HoldLine(hold: HoldUi, busy: Boolean, onHold: (Long?) -> Unit, onRelease: () -> Unit, centred: Boolean = true) {
    Column(horizontalAlignment = if (centred) Alignment.CenterHorizontally else Alignment.Start, modifier = Modifier.fillMaxWidth()) {
        val line =
            when (hold) {
                HoldUi.Offered -> Message.ScheduleTakesThisBack
                HoldUi.HeldUntilReleased -> Message.HeldUntilReleased
                is HoldUi.HeldUntil -> Message.HeldUntilAbout(hold.clock)
            }
        if (centred) {
            Text(line.resolve(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        } else {
            Text(line.resolve(), style = MaterialTheme.typography.bodyMedium)
        }
        // Left-aligned, the buttons' own padding would indent them from the sentence; pulled back
        // by it, their words line up under the sentence's.
        Row(
            horizontalArrangement = if (centred) Arrangement.Center else Arrangement.Start,
            modifier = if (centred) Modifier.fillMaxWidth() else Modifier.fillMaxWidth().offset(x = (-12).dp),
        ) {
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
fun AirModeRow(mode: AirMode, busy: Boolean, onAirMode: (AirMode) -> Unit) {
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
