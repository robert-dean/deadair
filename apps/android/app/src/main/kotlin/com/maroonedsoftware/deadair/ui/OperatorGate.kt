package com.maroonedsoftware.deadair.ui

import android.content.Context
import androidx.activity.compose.LocalActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.auth.SessionState

/** Anything that proves the phone's owner: a weak biometric is enough for a gate on what is drawn, and the screen lock is the way in when a finger fails. */
private const val OWNER_CHECKS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL

/** Whether this phone has any lock of its own to ask. */
fun ownerCanBeChecked(context: Context): Boolean = BiometricManager.from(context).canAuthenticate(OWNER_CHECKS) == BiometricManager.BIOMETRIC_SUCCESS

/**
 * Whether to draw the operator's controls: the role the station last reported, and the phone's
 * lock open. Every operator control reads this rather than the session, so locked is the listener's
 * app, and there is no second list of what the lock covers to keep up to date.
 */
@Composable
fun rememberOperates(graph: AppGraph): Boolean {
    val session by graph.sessions.state.collectAsStateWithLifecycle()
    val locked by graph.operatorLocked.collectAsStateWithLifecycle()
    return (session as? SessionState.SignedIn)?.isOperator == true && !locked
}

/**
 * Ask the phone whether this is its owner, and run `onPassed` if it says so.
 *
 * A phone whose lock has since been taken off has nothing left to ask, and answers yes: its owner
 * would otherwise be shut out of a lock only they turned on, by somebody who had to know the screen
 * lock to remove it. Cancelling, or failing, simply leaves things as they were.
 */
@Composable
fun rememberOwnerCheck(): (onPassed: () -> Unit) -> Unit {
    val activity = LocalActivity.current as FragmentActivity
    val title = stringResource(R.string.operator_lock_prompt)
    return remember(activity, title) {
        { onPassed ->
            if (ownerCanBeChecked(activity)) {
                val callback =
                    object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onPassed()
                    }
                BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
                    .authenticate(BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(OWNER_CHECKS).build())
            } else {
                onPassed()
            }
        }
    }
}

/** Unlock the operator's controls, once the phone has said this is its owner. */
@Composable
fun rememberUnlock(graph: AppGraph): () -> Unit {
    val checkOwner = rememberOwnerCheck()
    return remember(graph, checkOwner) { { checkOwner(graph.operatorLock::unlocked) } }
}

/**
 * A page that is nothing but the operator's, which says it is locked until it is not.
 *
 * Over the page rather than unwinding the stack, so a page the lock shut while the app was away is
 * still there after the unlock, and so a stack restored after process death needs no separate case.
 */
@Composable
fun OperatorGate(graph: AppGraph, content: @Composable () -> Unit) {
    val locked by graph.operatorLocked.collectAsStateWithLifecycle()
    if (!locked) {
        content()
        return
    }
    val unlock = rememberUnlock(graph)
    Surface(Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(painterResource(R.drawable.ic_lock), contentDescription = null)
            Text(stringResource(R.string.operator_lock_locked), style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            Text(stringResource(R.string.operator_lock_locked_detail), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            Button(onClick = unlock) { Text(stringResource(R.string.operator_lock_unlock)) }
        }
    }
}
