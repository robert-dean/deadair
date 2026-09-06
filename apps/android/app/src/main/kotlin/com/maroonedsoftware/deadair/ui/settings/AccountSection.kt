package com.maroonedsoftware.deadair.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
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
 * So this is a form for the person who runs the station, on their own phone — which is also why
 * the fields tell a password manager what they are. These are the console's real credentials, and
 * a form that cannot be filled is a form that gets a weaker password typed into it.
 */
@Composable
fun AccountSection(
    session: SessionState,
    account: AccountState,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
) {
    val focus = LocalFocusManager.current

    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        when (session) {
            is SessionState.SignedIn -> SignedIn(session, onSignOut)
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
                    enabled = !account.busy,
                    isError = account.error != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }),
                    modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.EmailAddress },
                )

                // Shown on request. A mistyped long password on a phone keyboard is a certain
                // retry, and this form clears the password on a refusal — so without a way to
                // look, a listener retypes blind, twice.
                var passwordShown by rememberSaveable { mutableStateOf(false) }
                OutlinedTextField(
                    value = account.password,
                    onValueChange = onPasswordChange,
                    label = { Text("Password") },
                    singleLine = true,
                    enabled = !account.busy,
                    isError = account.error != null,
                    // The error sits under the password rather than the email because that is the
                    // field a listener retypes, and it is the one this app clears for them.
                    supportingText = account.error?.let { { Text(it) } },
                    visualTransformation = if (passwordShown) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { passwordShown = !passwordShown }) {
                            Icon(
                                painterResource(if (passwordShown) R.drawable.ic_visibility_off else R.drawable.ic_visibility),
                                contentDescription = if (passwordShown) "Hide password" else "Show password",
                            )
                        }
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    // Done signs in, which is what a thumb on the last field of a form means.
                    keyboardActions = KeyboardActions(onDone = { if (account.canSubmit) onSignIn() }),
                    modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Password },
                )

                // The button keeps its place while the station answers, with the spinner inside
                // it. Swapping the whole button for a spinner moved the layout on every tap.
                Button(onClick = onSignIn, enabled = account.canSubmit, modifier = Modifier.fillMaxWidth()) {
                    if (account.busy) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = LocalContentColor.current)
                    } else {
                        Text("Sign in")
                    }
                }
            }
        }
    }
}

@Composable
private fun SignedIn(session: SessionState.SignedIn, onSignOut: () -> Unit) {
    ListItem(
        headlineContent = { Text(session.email) },
        // Which of the two things this account is, because the difference is the difference
        // between a phone that can skip a record and one that can only see it playing.
        supportingContent = {
            Text(if (session.isOperator) "Signed in as the operator of this station" else "Signed in to this station as a listener")
        },
        modifier = Modifier.fillMaxWidth(),
    )

    // Asked once. One tap on a full-width button drops the tokens and blanks two tabs, and a thumb
    // scrolling past it is the ordinary way that would happen.
    var confirming by rememberSaveable { mutableStateOf(false) }
    OutlinedButton(onClick = { confirming = true }, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Sign out?") },
            text = { Text("What the station has played and what is on next go back behind the sign-in. Listening is not affected.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = false
                        onSignOut()
                    },
                ) {
                    Text("Sign out")
                }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel") } },
        )
    }
}
