package com.maroonedsoftware.deadair.ui.catalog

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.maroonedsoftware.deadair.auth.NotSignedInException
import com.maroonedsoftware.deadair.sdk.runtime.SdkError
import com.maroonedsoftware.deadair.ui.LoadState
import kotlinx.coroutines.CancellationException

/** A detail page's one fetch: what it has, and a way to ask again. */
class Detail<T> internal constructor(state: LoadState<T>, private val bump: () -> Unit) {
    val state: LoadState<T> = state

    /** Ask again: after a failure, or after a write that changed what the page shows. */
    fun reload() = bump()
}

/**
 * Fetch one thing for the composition that asked, keyed on what identifies it.
 *
 * A change of key fetches afresh; a reload fetches again under the same key. A signed-out session
 * is reported as a 401 rather than thrown, because it is the ordinary way a page reached from a
 * deep link fails and the page should say so rather than crash.
 */
@Composable
fun <T> rememberDetail(key: Any?, load: suspend () -> T): Detail<T> {
    var attempt by remember(key) { mutableIntStateOf(0) }
    var state by remember(key) { mutableStateOf<LoadState<T>>(LoadState.Loading) }

    LaunchedEffect(key, attempt) {
        if (attempt > 0) state = LoadState.Loading
        state =
            try {
                LoadState.Loaded(load())
            } catch (error: CancellationException) {
                throw error
            } catch (error: NotSignedInException) {
                LoadState.Failed(UNAUTHORIZED)
            } catch (error: SdkError) {
                LoadState.Failed(error.status)
            } catch (error: Exception) {
                LoadState.Failed(null)
            }
    }

    return Detail(state) { attempt += 1 }
}

private const val UNAUTHORIZED = 401
