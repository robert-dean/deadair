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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.ui.text.resolve

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
    onCodeChange: (String) -> Unit,
    onSignIn: () -> Unit,
    onStartAgain: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        when (session) {
            is SessionState.SignedIn -> SignedIn(session, onSignOut)
            // Once the station has asked for a second factor the password step is over, and its
            // fields go with it: leaving them on screen invites a retype of something that was
            // accepted a moment ago, and there is nothing left to send them to.
            SessionState.SignedOut ->
                if (account.challenge != null) {
                    SecondFactor(account, onCodeChange, onSignIn, onStartAgain)
                } else {
                    PasswordForm(account, onEmailChange, onPasswordChange, onSignIn)
                }
        }
    }
}

@Composable
private fun PasswordForm(account: AccountState, onEmailChange: (String) -> Unit, onPasswordChange: (String) -> Unit, onSignIn: () -> Unit) {
    val focus = LocalFocusManager.current

    Text(stringResource(R.string.account_optional), style = MaterialTheme.typography.bodyMedium)

    OutlinedTextField(
        value = account.email,
        onValueChange = onEmailChange,
        label = { Text(stringResource(R.string.email)) },
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
        label = { Text(stringResource(R.string.password)) },
        singleLine = true,
        enabled = !account.busy,
        isError = account.error != null,
        // The error sits under the password rather than the email because that is the
        // field a listener retypes, and it is the one this app clears for them.
        // Announced when it lands, because the field the listener was in has just
        // been emptied under them and the reason is the only clue.
        supportingText = account.error?.let { { Text(it.resolve(), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) } },
        visualTransformation = if (passwordShown) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = {
            IconButton(onClick = { passwordShown = !passwordShown }) {
                Icon(
                    painterResource(if (passwordShown) R.drawable.ic_visibility_off else R.drawable.ic_visibility),
                    contentDescription = stringResource(if (passwordShown) R.string.hide_password else R.string.show_password),
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
            Text(stringResource(R.string.sign_in))
        }
    }
}

/**
 * The code box, once the station has asked for one.
 *
 * A separate step rather than a third field on the form, because it is a separate exchange: the
 * password has already been spent, and what is being answered is a challenge with its own clock.
 * Start again is on the screen for somebody who cannot reach their authenticator, and is the only
 * way out that does not involve waiting for the challenge to expire.
 */
@Composable
private fun SecondFactor(account: AccountState, onCodeChange: (String) -> Unit, onSubmit: () -> Unit, onStartAgain: () -> Unit) {
    Text(stringResource(R.string.second_factor_title), style = MaterialTheme.typography.titleSmall)
    Text(stringResource(R.string.second_factor_detail), style = MaterialTheme.typography.bodyMedium)

    val focus = LocalFocusManager.current
    OutlinedTextField(
        value = account.code,
        onValueChange = onCodeChange,
        label = { Text(stringResource(R.string.authenticator_code)) },
        singleLine = true,
        enabled = !account.busy,
        isError = account.error != null,
        // Announced when it lands: the field the operator was in has just been emptied under
        // them, and the reason is the only clue as to why.
        supportingText = account.error?.let { { Text(it.resolve(), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) } },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { if (account.canSubmit) onSubmit() else focus.clearFocus() }),
        // The one-time-code content type is what offers the code from a notification, which on a
        // phone is where a good half of them arrive.
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.SmsOtpCode },
    )

    Button(onClick = onSubmit, enabled = account.canSubmit, modifier = Modifier.fillMaxWidth()) {
        if (account.busy) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = LocalContentColor.current)
        } else {
            Text(stringResource(R.string.sign_in))
        }
    }

    TextButton(onClick = onStartAgain, enabled = !account.busy, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.start_again))
    }
}

@Composable
private fun SignedIn(session: SessionState.SignedIn, onSignOut: () -> Unit) {
    ListItem(
        headlineContent = { Text(session.email) },
        // Which of the two things this account is, because the difference is the difference
        // between a phone that can skip a record and one that can only see it playing.
        supportingContent = {
            Text(stringResource(if (session.isOperator) R.string.signed_in_operator else R.string.signed_in_listener))
        },
        modifier = Modifier.fillMaxWidth(),
    )

    // Asked once. One tap on a full-width button drops the tokens and blanks two tabs, and a thumb
    // scrolling past it is the ordinary way that would happen.
    var confirming by rememberSaveable { mutableStateOf(false) }
    OutlinedButton(onClick = { confirming = true }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.sign_out)) }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(R.string.sign_out_question)) },
            text = { Text(stringResource(R.string.sign_out_detail)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = false
                        onSignOut()
                    },
                ) {
                    Text(stringResource(R.string.sign_out))
                }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}
