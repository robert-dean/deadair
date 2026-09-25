package com.maroonedsoftware.deadair.ui.home

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.sdk.models.Rating
import com.maroonedsoftware.deadair.ui.nowplaying.LikeControl
import com.maroonedsoftware.deadair.ui.nowplaying.toggledLike
import kotlin.coroutines.cancellation.CancellationException
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
import kotlinx.coroutines.launch

/**
 * The heart on Now playing, for the record on air.
 *
 * The rating is read once per record, when it goes on air, rather than polled: the operator is the
 * only one who changes it, and when they do it is here or on the record's page. A read that fails
 * leaves the heart empty rather than wrong, and pressing an empty heart likes the record, which is
 * what it would have done anyway. The write is the record page's own ([com.maroonedsoftware.deadair.catalog.CatalogActions.rateTrack]),
 * so a refusal lands as that page's notice does, and the heart shows the mark only once the
 * station has taken it.
 */
@OptIn(ExperimentalUuidApi::class)
@Composable
fun rememberLike(graph: AppGraph, trackId: String): LikeControl {
    var rating by remember(trackId) { mutableStateOf<Rating?>(null) }
    var busy by remember(trackId) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(trackId) {
        rating =
            try {
                graph.sessions.withSession { it.catalog.getTrack(Uuid.parse(trackId)) }.rating
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                null
            }
    }

    return LikeControl(liked = rating?.let { it == Rating.LIKED }, enabled = !busy) {
        if (!busy) {
            val mark = toggledLike(rating)
            busy = true
            scope.launch {
                try {
                    if (graph.catalog.rateTrack(trackId, mark)) rating = mark
                } finally {
                    busy = false
                }
            }
        }
    }
}
