package com.maroonedsoftware.deadair.ui.setup

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.ui.PillTextField
import com.maroonedsoftware.deadair.ui.PrivacyPolicyLink
import com.maroonedsoftware.deadair.ui.settings.StationEntryState
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.FormMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter
import com.maroonedsoftware.deadair.ui.theme.PillHeight

/**
 * Name a station: on first run, or when a `deadair://` link proposes one.
 *
 * Two steps. A welcome first, because the address field is a strange first thing to meet in an app
 * somebody has just installed to listen to the radio; then the field. A link skips the welcome (see
 * [SetupStep.initial]), and back from the field returns to it unless a kept station is on offer,
 * where back means "keep the station I have" and `MainActivity` answers it.
 *
 * Nothing is prefilled by the app itself. There is no address that is right for more than one
 * person, and a wrong one that looks deliberate is worse than an empty field. A link is the one
 * exception, because somebody chose to follow it; even then the address is only in the field, and
 * nothing is kept until it has answered and been confirmed.
 */
@Composable
fun SetupScreen(
    state: StationEntryState,
    onAddressChange: (String) -> Unit,
    onCheck: () -> Unit,
    onConfirm: () -> Unit,
    /** Whether a `deadair://` link has put an address in the field. */
    proposing: Boolean = false,
    /** The station already kept, when a link has proposed another. `null` on first run. */
    listeningTo: String? = null,
    /** Turn the link down and go back to the kept station. Offered only when there is one. */
    onKeepCurrent: (() -> Unit)? = null,
    initialStep: SetupStep = SetupStep.initial(proposing),
) {
    var step by rememberSaveable { mutableStateOf(initialStep) }
    // A link can arrive while the welcome is showing, and it has filled a field nobody can see.
    LaunchedEffect(proposing) { if (proposing) step = SetupStep.STATION }
    val toWelcome = { step = SetupStep.WELCOME }
    BackHandler(enabled = step == SetupStep.STATION && onKeepCurrent == null, onBack = toWelcome)

    when (step) {
        SetupStep.WELCOME -> Welcome(onStart = { step = SetupStep.STATION })
        SetupStep.STATION ->
            Station(
                state = state,
                onAddressChange = onAddressChange,
                onCheck = onCheck,
                onConfirm = onConfirm,
                listeningTo = listeningTo,
                onKeepCurrent = onKeepCurrent,
                onBack = if (onKeepCurrent == null) toWelcome else null,
            )
    }
}

@Composable
private fun Welcome(onStart: () -> Unit) {
    // No insets from the scaffold: the blob runs up under the status bar, and the button column
    // takes the navigation bar's inset itself.
    Scaffold(contentWindowInsets = WindowInsets(0)) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
                WelcomeBackdrop(Modifier.matchParentSize())
                Image(
                    painterResource(R.drawable.ic_launcher_foreground),
                    contentDescription = null,
                    modifier = Modifier.align(BiasAlignment(0.3f, -1f)).statusBarsPadding().padding(top = 24.dp).size(112.dp),
                )
                // Over the blob's lower bulge, which is the part of it that reaches the left edge.
                Column(
                    modifier = Modifier.align(Alignment.BottomStart).padding(start = 32.dp, end = Gutter, bottom = maxHeight * 0.22f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        stringResource(R.string.welcome_eyebrow),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Text(
                        stringResource(R.string.welcome_headline),
                        style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.SemiBold),
                        color = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.widthIn(max = 320.dp).semantics { heading() },
                    )
                }
            }
            Column(
                modifier =
                    Modifier.align(Alignment.CenterHorizontally)
                        .widthIn(max = FormMaxWidth)
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = Gutter)
                        .padding(top = 24.dp, bottom = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Button(onClick = onStart, modifier = Modifier.fillMaxWidth().height(PillHeight)) { Text(stringResource(R.string.find_your_station)) }
                // Before any station, because this is the one screen a person without one can reach.
                PrivacyPolicyLink()
            }
        }
    }
}

@Composable
private fun Station(
    state: StationEntryState,
    onAddressChange: (String) -> Unit,
    onCheck: () -> Unit,
    onConfirm: () -> Unit,
    listeningTo: String?,
    onKeepCurrent: (() -> Unit)?,
    onBack: (() -> Unit)?,
) {
    Scaffold(contentWindowInsets = WindowInsets(0)) { padding ->
        // Scroll first and insets inside it, so the content slides under the bars rather than
        // stopping short of them; then the keyboard's own inset, so the button is never behind it.
        Box(
            modifier =
                Modifier.fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(padding)
                    .statusBarsPadding()
                    .navigationBarsPadding()
                    .imePadding(),
            contentAlignment = Alignment.TopCenter,
        ) {
            Column(
                modifier = Modifier.widthIn(max = FormMaxWidth).fillMaxWidth().padding(horizontal = Gutter).padding(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                if (onBack != null) {
                    IconButton(onClick = onBack, modifier = Modifier.padding(top = 4.dp)) {
                        Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.back))
                    }
                } else {
                    Spacer(Modifier.height(24.dp))
                }
                Text(
                    stringResource(R.string.find_your_station),
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.semantics { heading() },
                )
                Text(stringResource(R.string.setup_intro), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                listeningTo?.let { Text(stringResource(R.string.setup_link_note, it), style = MaterialTheme.typography.bodyMedium) }

                PillTextField(
                    value = state.address,
                    onValueChange = onAddressChange,
                    label = { Text(stringResource(R.string.station_address)) },
                    placeholder = { Text(stringResource(R.string.station_address_example)) },
                    isError = state.error != null,
                    supportingText = state.supportingText?.let { { Text(it.resolve()) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false, imeAction = ImeAction.Go),
                    // The key says Go, so Go does what the button does. A keyboard promising an
                    // action it will not perform is a small lie told on every press.
                    keyboardActions = KeyboardActions(onGo = { if (state.address.isNotBlank() && !state.checking) onCheck() }),
                    modifier = Modifier.fillMaxWidth(),
                )

                // The button keeps its place while the station answers, with the spinner inside it.
                // Swapping the whole button for a spinner moved the layout on every tap, and left
                // nothing to press while a check that can take five seconds ran.
                if (state.confirmedName != null) {
                    Button(onClick = onConfirm, modifier = Modifier.fillMaxWidth().height(PillHeight)) {
                        Text(stringResource(R.string.listen_to, state.confirmedName))
                    }
                } else {
                    Button(
                        onClick = onCheck,
                        enabled = state.address.isNotBlank() && !state.checking,
                        modifier = Modifier.fillMaxWidth().height(PillHeight),
                    ) {
                        if (state.checking) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = LocalContentColor.current)
                        } else {
                            Text(stringResource(R.string.check))
                        }
                    }
                }

                onKeepCurrent?.let {
                    TextButton(onClick = it, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.keep_current_station)) }
                }
            }
        }
    }
}
