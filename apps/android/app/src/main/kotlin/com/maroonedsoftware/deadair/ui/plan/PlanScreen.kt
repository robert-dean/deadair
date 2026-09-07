package com.maroonedsoftware.deadair.ui.plan

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.order.HostPicker
import com.maroonedsoftware.deadair.ui.order.activeHost
import com.maroonedsoftware.deadair.ui.order.hostChoicesOf
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.FormMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * Changing what the station plays, and saying whether this is still the same show.
 *
 * One screen rather than two, on the console's argument: the two station commands differ on exactly
 * one axis, and making it two controls encoded that axis as which one you tapped. So it is a
 * question, and the answer decides which fields EXIST. A replan carries a brief and nothing else —
 * the host, the period and the shape are read off the running order it is already on — so under
 * "keep this show" the rest is absent with a sentence saying where those live, rather than present
 * and greyed. A wall of disabled inputs invites an operator to try and says nothing about why they
 * cannot.
 *
 * The safe half is the default, and the two are not the same size of decision: keeping cuts nobody
 * off, and starting a new show is heard by everybody listening within a record.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanScreen(
    state: PlanUiState,
    personas: LoadState<List<Persona>>,
    busy: Boolean,
    snackbarHost: SnackbarHostState,
    onScope: (PlanScope) -> Unit,
    onForm: (PlanForm) -> Unit,
    onReloadPersonas: () -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
) {
    var picking by rememberSaveable { mutableStateOf(false) }
    var confirming by rememberSaveable { mutableStateOf(false) }
    val known = (personas as? LoadState.Loaded)?.value

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.plan)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).consumeWindowInsets(padding).imePadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().widthIn(max = FormMaxWidth).padding(horizontal = Gutter, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.showsScope) {
                    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                        SCOPES.forEachIndexed { index, (scope, label) ->
                            SegmentedButton(
                                selected = (scope == PlanScope.KEEP) == state.keeping,
                                onClick = { onScope(scope) },
                                enabled = !busy,
                                shape = SegmentedButtonDefaults.itemShape(index = index, count = SCOPES.size),
                            ) {
                                Text(stringResource(label), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }

                Text(stringResource(if (state.keeping) R.string.plan_keep_blurb else R.string.plan_new_blurb), style = MaterialTheme.typography.bodyMedium)

                if (state.warnsReplacing) {
                    Text(stringResource(R.string.plan_replacing_warning), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.tertiary)
                }

                Text(
                    stringResource(if (state.keeping) R.string.plan_brief_keep_desc else R.string.plan_brief_new_desc),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = state.form.brief,
                    onValueChange = { onForm(state.form.copy(brief = it.take(BRIEF_MAX))) },
                    label = { Text(stringResource(R.string.plan_brief_label)) },
                    placeholder = { Text(stringResource(R.string.plan_brief_placeholder)) },
                    enabled = !busy,
                    maxLines = 4,
                    supportingText = { Text(stringResource(R.string.plan_brief_count, state.form.brief.length, BRIEF_MAX)) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
                    modifier = Modifier.fillMaxWidth(),
                )

                if (state.keeping) {
                    // Absent rather than disabled: a replan carries a brief and nothing else, and
                    // the command that could change the rest is the one that ends the show.
                    Text(stringResource(R.string.plan_keep_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    NewShowFields(
                        state = state,
                        hostName = known?.let { list -> hostChoicesOf(list, state.form.personaId).firstOrNull { it.id == state.form.personaId }?.name },
                        busy = busy,
                        onForm = onForm,
                        onPickHost = { picking = true },
                    )
                }

                Text(
                    stringResource(if (state.keeping) R.string.plan_keep_footer else R.string.plan_new_footer),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onBack, enabled = !busy) { Text(stringResource(R.string.cancel)) }
                    Button(
                        onClick = { if (state.warnsReplacing) confirming = true else onSubmit() },
                        enabled = state.canSubmit && !busy,
                        modifier = Modifier.padding(start = 8.dp),
                    ) {
                        Text(stringResource(if (state.keeping) R.string.plan_replan else R.string.plan_go_on_air))
                    }
                }
            }
        }
    }

    if (picking) {
        HostPicker(
            choices = known?.let { hostChoicesOf(it, state.form.personaId) }.orEmpty(),
            // Always offered here: this broadcast does not exist yet, so "whichever persona the
            // station has on air" is a choice about it rather than a handing back.
            stationsOwnEnabled = true,
            stationsOwnName = known?.activeHost()?.label,
            selectedId = state.form.personaId,
            note = null,
            busy = busy,
            personas = personas,
            onRetry = onReloadPersonas,
            onPick = { id ->
                picking = false
                onForm(state.form.copy(personaId = id))
            },
            onDismiss = { picking = false },
        )
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(R.string.plan_confirm_title)) },
            text = { Text(stringResource(R.string.plan_replacing_warning)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = false
                        onSubmit()
                    },
                ) {
                    Text(stringResource(R.string.plan_go_on_air))
                }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

/** Everything that belongs to a broadcast rather than to a stretch of it, and so only exists on a new one. */
@Composable
private fun NewShowFields(state: PlanUiState, hostName: String?, busy: Boolean, onForm: (PlanForm) -> Unit, onPickHost: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(
            modifier = Modifier.fillMaxWidth().selectable(selected = false, enabled = !busy, role = Role.Button, onClick = onPickHost).padding(vertical = 4.dp),
        ) {
            Text(stringResource(R.string.plan_hosted_by), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(hostName ?: stringResource(R.string.plan_host_unset), style = MaterialTheme.typography.bodyLarge)
        }

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            YearField(
                value = state.form.eraFrom,
                label = R.string.plan_era_from,
                description = R.string.plan_era_from_desc,
                error = state.eraFromError,
                enabled = !busy,
                imeAction = ImeAction.Next,
                onValueChange = { onForm(state.form.copy(eraFrom = it)) },
                modifier = Modifier.weight(1f),
            )
            YearField(
                value = state.form.eraTo,
                label = R.string.plan_era_to,
                description = R.string.plan_era_to_desc,
                error = state.eraToError,
                enabled = !busy,
                imeAction = ImeAction.Done,
                onValueChange = { onForm(state.form.copy(eraTo = it)) },
                modifier = Modifier.weight(1f),
            )
        }
        Note(R.string.plan_era_note)

        Choices(
            heading = R.string.plan_mode,
            options = StationMode.entries,
            selected = state.form.mode,
            label = { Message.Mode(it).resolve() },
            enabled = !busy,
            onPick = { onForm(state.form.copy(mode = it)) },
        )
        Choices(
            heading = R.string.plan_on_end,
            options = StationOnEnd.entries,
            selected = state.form.onEnd,
            label = { Message.OnEnd(it).resolve() },
            enabled = !busy,
            onPick = { onForm(state.form.copy(onEnd = it)) },
        )
        Note(R.string.plan_shape_note)

        Row(
            modifier =
                Modifier.fillMaxWidth()
                    .toggleable(value = state.form.callins, enabled = !busy, role = Role.Checkbox, onValueChange = { onForm(state.form.copy(callins = it)) })
                    .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = state.form.callins, onCheckedChange = null, enabled = !busy)
            Column(modifier = Modifier.padding(start = 12.dp)) {
                Text(stringResource(R.string.plan_callins), style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(R.string.plan_callins_desc), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** A year, or nothing. Digits only, because a period is four figures and a keyboard offers more. */
@Composable
private fun YearField(
    value: String,
    label: Int,
    description: Int,
    error: Message?,
    enabled: Boolean,
    imeAction: ImeAction,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { typed -> onValueChange(typed.filter(Char::isDigit).take(4)) },
        label = { Text(stringResource(label)) },
        singleLine = true,
        enabled = enabled,
        isError = error != null,
        supportingText = {
            Text(
                error?.resolve() ?: stringResource(description),
                color = if (error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = imeAction),
        modifier = modifier,
    )
}

/** One question with a short list of answers, read as one choice rather than as unrelated switches. */
@Composable
private fun <T> Choices(heading: Int, options: List<T>, selected: T, label: @Composable (T) -> String, enabled: Boolean, onPick: (T) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(heading), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(modifier = Modifier.fillMaxWidth().selectableGroup()) {
            options.forEach { option ->
                Row(
                    modifier =
                        Modifier.fillMaxWidth()
                            .selectable(selected = option == selected, enabled = enabled, role = Role.RadioButton, onClick = { onPick(option) })
                            .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = option == selected, onClick = null, enabled = enabled)
                    Text(label(option), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 12.dp))
                }
            }
        }
    }
}

@Composable
private fun Note(text: Int) {
    Text(stringResource(text), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

private val SCOPES = listOf(PlanScope.KEEP to R.string.plan_keep, PlanScope.NEW to R.string.plan_new)
