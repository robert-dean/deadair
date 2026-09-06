package com.maroonedsoftware.deadair.ui.nowplaying

import android.content.ClipData
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.sdk.models.SilenceCheck
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import kotlinx.coroutines.launch

/**
 * Why the station is or is not on air, one tap deep.
 *
 * The console's diagnosis panel with the same split it makes: a lamp and two words always, and the
 * reason, the remedy and everything the station ruled out behind a tap. Shut by default while the
 * station is live or merely waiting, because on this screen the play button is the point and eleven
 * lines of gates that passed would push it off the bottom; open on its own the moment there is a
 * fault, because that is when the lines are worth reading.
 *
 * Nothing here decides anything. Every sentence comes from the station.
 */
@Composable
fun SilencePanel(reading: SilenceReading, modifier: Modifier = Modifier) {
    var open by rememberSaveable { mutableStateOf(reading.tone == SilenceTone.FAULT) }
    LaunchedEffect(reading.tone) {
        if (reading.tone == SilenceTone.FAULT) open = true
    }

    val label = reading.label.resolve()
    OutlinedCard(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier =
                Modifier.fillMaxWidth()
                    .toggleable(value = open, role = Role.Button, onValueChange = { open = it })
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Lamp(reading.tone)
            Text(label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Icon(
                painterResource(if (open) R.drawable.ic_expand_less else R.drawable.ic_expand_more),
                contentDescription = stringResource(if (open) R.string.hide_why else R.string.show_why),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        AnimatedVisibility(visible = open) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (!reading.live) Text(reading.title.resolve(), style = MaterialTheme.typography.titleMedium)
                Text(reading.detail, style = MaterialTheme.typography.bodyMedium)
                reading.remedy?.let { RemedyLine(it) }

                reading.otherFaults.forEach { fault -> OtherFault(fault) }

                if (reading.ruledOut.isNotEmpty()) RuledOut(reading.ruledOut)
            }
        }
    }
}

@Composable
private fun Lamp(tone: SilenceTone) {
    val colour: Color =
        when (tone) {
            SilenceTone.LIVE -> MaterialTheme.colorScheme.primary
            SilenceTone.STANDBY -> MaterialTheme.colorScheme.tertiary
            SilenceTone.OFF -> MaterialTheme.colorScheme.outline
            SilenceTone.FAULT -> MaterialTheme.colorScheme.error
        }
    Box(modifier = Modifier.size(10.dp).background(colour, CircleShape))
}

/**
 * What would clear it.
 *
 * A shell command is set in monospace with a Copy button and nothing else, on the console's own
 * argument: the app cannot restart a sibling container, and a button that pretended otherwise would
 * be a lie about what a phone can do. Anything that is not a command is a sentence.
 */
@Composable
private fun RemedyLine(remedy: Remedy) {
    if (!remedy.isCommand) {
        Text(remedy.text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }

    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by rememberSaveable(remedy.text) { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            remedy.text,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            modifier = Modifier.weight(1f),
        )
        TextButton(
            onClick = {
                scope.launch {
                    clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("remedy", remedy.text)))
                    copied = true
                }
            },
        ) {
            Text(stringResource(if (copied) R.string.copied else R.string.copy))
        }
    }
}

@Composable
private fun OtherFault(fault: SilenceCheck) {
    Column(
        modifier =
            Modifier.fillMaxWidth()
                .background(MaterialTheme.colorScheme.errorContainer, MaterialTheme.shapes.small)
                .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(Message.SilenceTitle(fault.code).resolve(), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onErrorContainer)
        Text(fault.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
        fault.remedy?.let { RemedyLine(Remedy(it)) }
    }
}

/**
 * What the station checked and was happy with: the reason this panel exists rather than a bigger
 * subtitle. Somebody chasing silence is deciding where to look next, and a list of places they do
 * not have to look is most of that decision.
 */
@Composable
private fun RuledOut(checks: List<SilenceCheck>) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            stringResource(R.string.ruled_out, checks.size),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        checks.forEach { check ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(Message.SilenceLabel(check.code).resolve(), style = MaterialTheme.typography.labelMedium)
                Text(
                    check.detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}
