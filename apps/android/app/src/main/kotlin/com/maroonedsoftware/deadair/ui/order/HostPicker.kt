package com.maroonedsoftware.deadair.ui.order

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.ui.ErrorPlaceholder
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * Who presents this show, as a sheet of choices.
 *
 * One question with a list of answers, so radio rows rather than a menu of buttons: which one is
 * presenting now is as much the point as which ones could. The first row hands the broadcast back
 * to whoever the station has on air, which is a real answer rather than the absence of one.
 *
 * The persona list is fetched by whoever opens this and passed in, because it is a read a listener
 * is already allowed to make and it changes only when somebody edits a persona.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostPicker(
    choices: List<HostChoice>,
    stationsOwnEnabled: Boolean,
    stationsOwnName: String?,
    /** Which row is drawn as chosen. `null` means the station's own host. */
    selectedId: String?,
    /** What changing this does, said once above the list. Absent where the surrounding screen has already said it. */
    @StringRes note: Int?,
    busy: Boolean,
    personas: LoadState<List<Persona>>,
    onRetry: () -> Unit,
    onPick: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = Gutter).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.host_picker_title), style = MaterialTheme.typography.titleMedium)
            note?.let { Text(stringResource(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }

            when (personas) {
                LoadState.Loading ->
                    Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                is LoadState.Failed -> ErrorPlaceholder(stringResource(R.string.error_could_not_reach), onRetry)
                is LoadState.Loaded ->
                    Column(modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState()).selectableGroup()) {
                        HostRow(
                            name = stringResource(R.string.stations_host),
                            supporting = stationsOwnName,
                            selected = selectedId == null,
                            enabled = stationsOwnEnabled && !busy,
                            onPick = { onPick(null) },
                        )
                        choices.forEach { choice ->
                            HostRow(
                                name = if (choice.onAir) stringResource(R.string.host_on_air, choice.name) else choice.name,
                                supporting = choice.djName,
                                selected = choice.id == selectedId,
                                enabled = !choice.current && !busy,
                                onPick = { onPick(choice.id) },
                            )
                        }
                    }
            }
        }
    }
}

@Composable
private fun HostRow(name: String, supporting: String?, selected: Boolean, enabled: Boolean, onPick: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onPick).padding(vertical = 4.dp),
    ) {
        androidx.compose.foundation.layout.Row(verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = selected, onClick = null, enabled = enabled)
            Column(modifier = Modifier.padding(start = 12.dp)) {
                Text(name, style = MaterialTheme.typography.bodyLarge, color = if (enabled || selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                supporting?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}
