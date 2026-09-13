package com.maroonedsoftware.deadair.ui.nowplaying

import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.playback.SleepRequest
import com.maroonedsoftware.deadair.playback.SleepState
import com.maroonedsoftware.deadair.ui.text.resolve
import kotlinx.coroutines.delay

/**
 * The sleep timer: a moon that opens the choices, and the countdown beside it while one is set.
 *
 * "After this record" is offered only when the station can say how much of the record is left,
 * which is the rule the progress bar already keeps: a timer set against a guess would stop the
 * station at the wrong moment for somebody who is by then asleep and cannot say so. `onSleep(null)`
 * turns it off.
 */
@Composable
fun SleepControl(sleep: SleepState, canWaitForRecord: Boolean, onSleep: (SleepRequest?) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    // Ticks once a second while a countdown is showing, and not at all otherwise.
    val now by produceState(SystemClock.elapsedRealtime(), sleep) {
        while (sleep is SleepState.Until) {
            value = SystemClock.elapsedRealtime()
            delay(1_000)
        }
    }

    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box {
            IconButton(onClick = { open = true }) {
                Icon(
                    painterResource(R.drawable.ic_bedtime),
                    contentDescription = stringResource(R.string.sleep_timer),
                    tint = if (sleep == SleepState.Off) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
                )
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                SLEEP_CHOICES.forEach { minutes ->
                    DropdownMenuItem(
                        text = { Text(pluralStringResource(R.plurals.sleep_minutes, minutes.toInt(), minutes.toInt())) },
                        onClick = {
                            open = false
                            onSleep(SleepRequest.Minutes(minutes))
                        },
                    )
                }
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.sleep_after_this_record)) },
                    enabled = canWaitForRecord,
                    onClick = {
                        open = false
                        onSleep(SleepRequest.AfterRecord)
                    },
                )
                if (sleep != SleepState.Off) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.sleep_off)) },
                        onClick = {
                            open = false
                            onSleep(null)
                        },
                    )
                }
            }
        }
        sleepLine(sleep, now)?.let {
            Text(it.resolve(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
