package com.maroonedsoftware.deadair.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * What a tab shows before anybody has signed in.
 *
 * An offer rather than a wall, and phrased as one. The station keeps this behind an account because
 * it is the console's own data, not because a listener is unwelcome — and the tab is reachable
 * without one precisely so the offer can be seen at all.
 */
@Composable
fun SignedOutPlaceholder(what: String, onSettings: () -> Unit) {
    CentredColumn {
        Text(what, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(
            "The station keeps this for signed-in listeners. Listening itself needs no account.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
        Button(onClick = onSettings, modifier = Modifier.padding(top = 24.dp)) { Text("Sign in") }
    }
}

/**
 * A tab that could not reach the station and has nothing older to show instead.
 *
 * Told apart from an empty answer by having something to press. Every poll backs off while the
 * station is not answering, up to five minutes, and a listener who has just fixed their wifi
 * should not have to wait that out looking at a sentence.
 */
@Composable
fun ErrorPlaceholder(what: String, onRetry: () -> Unit) {
    CentredColumn {
        Text(what, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(
            "Check that you are on the right network. The app keeps trying on its own, more slowly each time.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
        Button(onClick = onRetry, modifier = Modifier.padding(top = 24.dp)) { Text("Try again") }
    }
}

/** The same shape for a tab that has nothing to show yet, so an empty answer is not read as a fault. */
@Composable
fun EmptyPlaceholder(what: String) {
    CentredColumn {
        Text(
            what,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}
