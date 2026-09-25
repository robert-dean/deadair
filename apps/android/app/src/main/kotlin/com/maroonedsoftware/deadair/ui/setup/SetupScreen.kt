package com.maroonedsoftware.deadair.ui.setup

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.FastOutSlowInEasing
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
import androidx.compose.foundation.layout.width
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
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
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
    /**
     * Keep the station and go straight on to signing in to it. Offered once the address has
     * answered and not before, because an account belongs to a station and there is not one yet.
     */
    onConfirmAndSignIn: (() -> Unit)? = null,
    /** Scan the console's code. `null` on a phone that cannot, which then only types. */
    onScan: (() -> Unit)? = null,
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
                onConfirmAndSignIn = onConfirmAndSignIn,
                onScan = onScan,
                listeningTo = listeningTo,
                onKeepCurrent = onKeepCurrent,
                onBack = if (onKeepCurrent == null) toWelcome else null,
            )
    }
}

/** How far the words and the button rise as they fade in. */
private val RevealRise = 24.dp

@Composable
private fun Welcome(onStart: () -> Unit) {
    // The splash hands over with the mark exactly where it was, so the mark stays put and what the
    // splash did not have fades in around it: the name first, then the button. Once per arrival,
    // and saveable, so coming back from the address step or turning the phone does not replay it.
    // A phone with animations turned off gets it finished at once, because Compose honours that.
    var revealed by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { revealed = true }
    val words by animateFloatAsState(if (revealed) 1f else 0f, tween(durationMillis = 500, delayMillis = 150, easing = FastOutSlowInEasing))
    val action by animateFloatAsState(if (revealed) 1f else 0f, tween(durationMillis = 500, delayMillis = 350, easing = FastOutSlowInEasing))
    // No insets from the scaffold: the mark is centred on the WHOLE window, because that is where
    // the splash screen drew it, and the button column takes the navigation bar's inset itself.
    Scaffold(contentWindowInsets = WindowInsets(0)) { padding ->
        BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
            // A short window (a phone on its side) cannot fit the splash's size above the words and
            // the button, and there is no splash position worth matching there anyway.
            val height = maxHeight
            val mark = if (height < 600.dp) SplashMarkSize / 2 else SplashMarkSize
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                Spacer(Modifier.height((height - mark) / 2))
                StationMark(size = mark)
                Spacer(Modifier.height(32.dp))
                // The station's name and nothing else: the mark says what this is, and the button
                // says what to do next.
                Text(
                    stringResource(R.string.app_name),
                    style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.SemiBold),
                    modifier = Modifier.reveal(words).semantics { heading() },
                )
                Spacer(Modifier.weight(1f))
                Column(
                    modifier =
                        Modifier.reveal(action)
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
}

@Composable
private fun Station(
    state: StationEntryState,
    onAddressChange: (String) -> Unit,
    onCheck: () -> Unit,
    onConfirm: () -> Unit,
    onConfirmAndSignIn: (() -> Unit)?,
    onScan: (() -> Unit)?,
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
                    // Second, and quieter, because most people who get this far only want to listen.
                    onConfirmAndSignIn?.let {
                        OutlinedButton(onClick = it, modifier = Modifier.fillMaxWidth().height(PillHeight)) {
                            Text(stringResource(R.string.run_this_station))
                        }
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
                    // The console's Checkup page shows this code, and it is the whole address with
                    // nothing to mistype, so it is offered beside the button that checks a typed one.
                    onScan?.let {
                        OutlinedButton(onClick = it, enabled = !state.checking, modifier = Modifier.fillMaxWidth().height(PillHeight)) {
                            Icon(painterResource(R.drawable.ic_qr_code_scanner), contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.scan_station_code))
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

/** Faded and lowered by what is left of [progress], so 0 is hidden and [RevealRise] down, 1 is in place. */
private fun Modifier.reveal(progress: Float): Modifier =
    graphicsLayer {
        alpha = progress
        translationY = (1f - progress) * RevealRise.toPx()
    }
