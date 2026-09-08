package com.maroonedsoftware.deadair.ui

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import kotlinx.coroutines.flow.SharedFlow

/**
 * What an operator action came back with, said once.
 *
 * Every screen that can start one needs its own, because the flow keeps nothing for a collector
 * that is not running and the display composes only the entry on top: a notice raised by a pushed
 * screen would otherwise be posted to a Home that is not there to hear it, and the operator would
 * watch a button do nothing. Collected into state and resolved in composition, because the words
 * live in resources and a snackbar wants a string.
 */
@Composable
fun ShowOperatorNotices(notices: SharedFlow<Notice>, host: SnackbarHostState) {
    var notice by remember { mutableStateOf<Notice?>(null) }
    LaunchedEffect(notices) { notices.collect { notice = it } }

    notice?.let { current ->
        val words = Message.OperatorNotice(current).resolve()
        LaunchedEffect(current) {
            host.showSnackbar(words)
            if (notice == current) notice = null
        }
    }
}
