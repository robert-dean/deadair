package com.maroonedsoftware.deadair.ui.order

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * What is on, what it was asked to play, and who is presenting it.
 *
 * Above the running order rather than inside it, because it is about the broadcast rather than
 * about any row, and it survives the list being empty: off air this is the only thing on the tab
 * with anything to say.
 *
 * The host is a chip rather than a line of text for an operator, on the console's argument that a
 * hold which cannot be SEEN is worse than no hold: the state and the way to change it are the same
 * control.
 */
@Composable
fun BroadcastHeader(
    ui: BroadcastUiState,
    personas: LoadState<List<Persona>>,
    onReloadPersonas: () -> Unit,
    /** `null` for anyone the station does not call its operator, which draws the host as a line rather than a control. */
    onRecast: ((String?) -> Unit)?,
    busy: Boolean,
    modifier: Modifier = Modifier,
) {
    var picking by remember { mutableStateOf(false) }

    Column(modifier = modifier.fillMaxWidth().padding(horizontal = Gutter, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        ui.title?.let { Text(it, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis) }

        val host = ui.hostMessage.resolve()
        if (onRecast != null && ui.canRecast) {
            AssistChip(
                onClick = { picking = true },
                enabled = !busy,
                label = { Text(host, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                leadingIcon = { Icon(painterResource(R.drawable.ic_record_voice_over), contentDescription = null, modifier = Modifier.size(18.dp)) },
            )
        } else {
            Text(host, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        ui.brief?.let {
            Text(
                Message.AskedFor(it).resolve(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }

    if (picking && onRecast != null) {
        HostPicker(
            choices = ui.hostChoices,
            stationsOwnEnabled = ui.stationsOwnEnabled,
            stationsOwnName = ui.stationsOwnName,
            selectedId = ui.order.personaId,
            note = R.string.host_picker_note,
            busy = busy,
            personas = personas,
            onRetry = onReloadPersonas,
            onPick = { id ->
                picking = false
                onRecast(id)
            },
            onDismiss = { picking = false },
        )
    }
}
