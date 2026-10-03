package com.maroonedsoftware.deadair.ui.request

import com.maroonedsoftware.deadair.sdk.models.ListenerRequest
import com.maroonedsoftware.deadair.sdk.models.ListenerRequestCreate
import com.maroonedsoftware.deadair.sdk.models.RequestStatus
import com.maroonedsoftware.deadair.sdk.models.RequestableTrack
import com.maroonedsoftware.deadair.ui.history.airedLabel
import com.maroonedsoftware.deadair.ui.text.Message
import java.time.ZoneId
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * How many matches the request search asks for: the station's ceiling. A listener narrows by typing
 * rather than by paging, so there is no second page to fetch.
 */
const val REQUEST_SEARCH_LIMIT = 25L

/** The station's own caps on what goes with a request (`ListenerRequestCreate`), so a field cannot hold a 400. */
const val REQUEST_NAME_MAX = 60
const val REQUEST_DEDICATE_MAX = 60
const val REQUEST_MESSAGE_MAX = 200

/** How often My requests is asked again while the page is showing. The console's cadence for the same list. */
const val MY_REQUESTS_POLL_MS = 15_000L

/**
 * One match from the request search, as the list draws it.
 *
 * Every row is requestable: the station's search leaves out anything it could not play or that
 * somebody has disliked, so there is no "cannot be asked for" row to draw. A request can still be
 * refused, by the station's rules rather than the record's.
 */
data class RequestRow(val id: String, val title: String, val artist: String, val detail: String?) {
    companion object {
        @OptIn(ExperimentalUuidApi::class)
        fun of(track: RequestableTrack) =
            RequestRow(
                id = track.trackId.toString(),
                title = track.title,
                artist = track.artist,
                detail = listOfNotNull(track.album, track.year?.toString()).joinToString(" · ").ifEmpty { null },
            )
    }
}

/**
 * What goes with a request, as typed.
 *
 * A blank field is OMITTED rather than sent empty: the station refuses an empty string (`min=1`), and
 * an omitted name is "a listener", which is the right answer for somebody who left it blank.
 */
data class RequestForm(val name: String = "", val dedicateTo: String = "", val message: String = "") {
    @OptIn(ExperimentalUuidApi::class)
    fun body(trackId: String) =
        ListenerRequestCreate(
            trackId = Uuid.parse(trackId),
            name = name.sent(REQUEST_NAME_MAX),
            dedicateTo = dedicateTo.sent(REQUEST_DEDICATE_MAX),
            message = message.sent(REQUEST_MESSAGE_MAX),
        )

    private fun String.sent(max: Int): String? = trim().take(max).ifEmpty { null }
}

/**
 * What the station did with a request it has just been sent.
 *
 * A refusal is not an error here: the station answers 201 with the request it wrote, `declined` and
 * a reason in its own words, so the status is what decides the sentence, never the HTTP code.
 */
fun requestOutcome(request: ListenerRequest): Message =
    when (request.status) {
        RequestStatus.WAITING -> Message.RequestWaiting(request.title)
        RequestStatus.PENDING, RequestStatus.QUEUED, RequestStatus.AIRED -> Message.RequestOnItsWay(request.title)
        RequestStatus.DECLINED, RequestStatus.EXPIRED -> Message.RequestRefused(request.reason)
    }

/** Whether the station may still play it. The open states, as the console counts them. */
fun isOpen(status: RequestStatus): Boolean = status == RequestStatus.WAITING || status == RequestStatus.PENDING || status == RequestStatus.QUEUED

/**
 * One of the listener's own requests, with the line under it.
 *
 * The note is the most useful thing to know next: when it aired, why it never will, or who it is for
 * while it is still on its way.
 */
data class MyRequestRow(val id: String, val title: String, val artist: String, val status: RequestStatus, val note: Message?) {
    companion object {
        @OptIn(ExperimentalUuidApi::class)
        fun of(request: ListenerRequest, nowEpochMs: Long, zone: ZoneId) =
            MyRequestRow(
                id = request.id.toString(),
                title = request.title,
                artist = request.artist,
                status = request.status,
                note =
                    when (request.status) {
                        RequestStatus.AIRED -> request.airedAt?.let { Message.Aired(airedLabel(it.toEpochMilliseconds(), nowEpochMs, zone)) }
                        RequestStatus.DECLINED, RequestStatus.EXPIRED -> request.reason?.let(Message::Text)
                        else -> request.dedicateTo?.let(Message::RequestFor)
                    },
            )
    }
}
