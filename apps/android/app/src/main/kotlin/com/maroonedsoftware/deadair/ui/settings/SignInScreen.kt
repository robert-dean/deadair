package com.maroonedsoftware.deadair.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.ui.setup.WelcomeBackdrop
import com.maroonedsoftware.deadair.ui.theme.FormMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter

/** How tall the backdrop band at the head of the page is. */
private val BandHeight = 240.dp

/**
 * Signing in, as a page of its own.
 *
 * Pushed over whichever screen asked, and closed by the root the moment the station issues a
 * session, so whoever tapped Sign in on the desk or Up next lands back there with it loaded rather
 * than on the Settings tab. Back is cancel, and starts the sign-in again: a half-finished code step
 * is not worth coming back to, because its challenge has a clock.
 *
 * The station's name heads it, because these are that station's credentials and a phone may have
 * been pointed at another one since. It sits on the welcome screen's backdrop, cut to a band, so
 * the two pages a first run can show read as one design.
 */
@Composable
fun SignInScreen(
    /** What the station calls itself, or its address before it has said. */
    station: String,
    account: AccountState,
    onBack: () -> Unit,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onCodeChange: (String) -> Unit,
    onSignIn: () -> Unit,
    onStartAgain: () -> Unit,
) {
    // No insets from the scaffold: the band runs up under the status bar, and the content below
    // it takes the navigation bar's and the keyboard's itself.
    Scaffold(contentWindowInsets = WindowInsets(0)) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.fillMaxWidth().height(BandHeight)) {
                WelcomeBackdrop(Modifier.matchParentSize())
                IconButton(onClick = onBack, modifier = Modifier.statusBarsPadding().padding(4.dp)) {
                    Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.back))
                }
                // The code step has its own heading; this one belongs to the first. Over the
                // blob's lower bulge, which is the part of it that reaches the left edge.
                if (account.challenge == null) {
                    Text(
                        stringResource(R.string.sign_in_to, station),
                        style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = MaterialTheme.colorScheme.onPrimary,
                        modifier =
                            Modifier.align(Alignment.BottomStart)
                                .padding(start = 32.dp, end = Gutter, bottom = BandHeight * 0.22f)
                                .widthIn(max = 300.dp)
                                .semantics { heading() },
                    )
                }
            }
            Column(
                modifier =
                    Modifier.widthIn(max = FormMaxWidth)
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = Gutter)
                        .padding(top = 8.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                if (account.challenge == null) {
                    Text(stringResource(R.string.sign_in_detail), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                SignInForm(
                    account = account,
                    onEmailChange = onEmailChange,
                    onPasswordChange = onPasswordChange,
                    onCodeChange = onCodeChange,
                    onSignIn = onSignIn,
                    onStartAgain = onStartAgain,
                )
            }
        }
    }
}
