package com.maroonedsoftware.deadair.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.auth.SessionState

/**
 * Signing in, which most listeners never will.
 *
 * It is last on the screen and says so in its own words: listening needs no account, and the two
 * things an account adds — what the station played, what is on next — are worth naming here rather
 * than leaving a listener to guess what they would be signing in FOR.
 *
 * The account is the operator's own, because it is the only kind the station issues: there is no
 * route that creates a listener account, and the role that would hold one is granted by nothing.
 * So this is a form for the person who runs the station, on their own phone.
 */
@Composable
fun AccountSection(
    session: SessionState,
    account: AccountState,
    signedInEnabled: Boolean,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        when (session) {
            is SessionState.SignedIn -> {
                ListItem(
                    headlineContent = { Text(session.email) },
                    supportingContent = { Text("Signed in to this station") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
            }
            SessionState.SignedOut -> {
                Text(
                    "Optional. Listening needs no account. Signing in adds what the station has played and what is on next.",
                    style = MaterialTheme.typography.bodyMedium,
                )

                OutlinedTextField(
                    value = account.email,
                    onValueChange = onEmailChange,
                    label = { Text("Email") },
                    singleLine = true,
                    enabled = signedInEnabled && !account.busy,
                    isError = account.error != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth(),
                )

                OutlinedTextField(
                    value = account.password,
                    onValueChange = onPasswordChange,
                    label = { Text("Password") },
                    singleLine = true,
                    enabled = signedInEnabled && !account.busy,
                    isError = account.error != null,
                    // The error sits under the password rather than the email because that is the
                    // field a listener retypes, and it is the one this app clears for them.
                    supportingText = account.error?.let { { Text(it) } },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth(),
                )

                if (account.busy) {
                    CircularProgressIndicator()
                } else {
                    Button(
                        onClick = onSignIn,
                        // Nothing to sign in TO until a station has been kept. The fields are shown
                        // rather than hidden so the option is visible from the first run.
                        enabled = signedInEnabled && account.canSubmit,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Sign in")
                    }
                }
            }
        }
    }
}
