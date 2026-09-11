package com.maroonedsoftware.deadair.ui

import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import com.maroonedsoftware.deadair.R

/**
 * Where the privacy policy is published: `apps/android/PRIVACY.md`, copied onto the website by its
 * build. The Play listing names the same address.
 *
 * The path is a promise to every install that has it, so it does not move. See `apps/site/CLAUDE.md`.
 */
const val PRIVACY_POLICY_URL = "https://deadair.radio/privacy/android"

/**
 * The policy, opened in the browser.
 *
 * On the setup screen as well as in settings, because Google Play requires the policy to be
 * reachable from inside the app, and settings is not reachable until a station has been named: a
 * reviewer with no station to type in would otherwise never find it.
 */
@Composable
fun PrivacyPolicyLink(modifier: Modifier = Modifier) {
    val uris = LocalUriHandler.current
    TextButton(onClick = { uris.openUri(PRIVACY_POLICY_URL) }, modifier = modifier) { Text(stringResource(R.string.privacy_policy)) }
}
