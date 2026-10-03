package com.maroonedsoftware.deadair.ui.request

import com.maroonedsoftware.deadair.sdk.models.ListenerRequest
import com.maroonedsoftware.deadair.sdk.models.RequestSource
import com.maroonedsoftware.deadair.sdk.models.RequestStatus
import com.maroonedsoftware.deadair.sdk.models.RequestableSource
import com.maroonedsoftware.deadair.sdk.models.RequestableTrack
import com.maroonedsoftware.deadair.ui.text.AiredLabel
import com.maroonedsoftware.deadair.ui.text.Clock
import com.maroonedsoftware.deadair.ui.text.Message
import java.time.ZoneOffset
import kotlin.time.Instant
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The request page's rules, which are the station's rules restated.
 *
 * Two of them are easy to get wrong at the screen: a blank field is a 400 if it is sent rather than
 * left out, and a refusal arrives as a 201, so the status and not the code decides what is said.
 */
@OptIn(ExperimentalUuidApi::class)
class RequestUiStateTest {
    private val trackId = "5b0e8a52-3c1f-4d2a-9e7b-0f6c1d2e3a4b"

    private fun request(status: RequestStatus, reason: String? = null, airedAt: String? = null, dedicateTo: String? = null) =
        ListenerRequest(
            id = Uuid.parse("0c9f3e1a-7b2d-4e8f-a1c3-5d6e7f809a1b"),
            status = status,
            title = "Blue Monday",
            artist = "New Order",
            requesterName = "a listener",
            source = RequestSource.APP,
            createdAt = Instant.parse("2026-10-03T20:00:00Z"),
            reason = reason,
            airedAt = airedAt?.let(Instant::parse),
            dedicateTo = dedicateTo,
        )

    @Test
    fun `a row carries album and year when the station knows them`() {
        val row = RequestRow.of(RequestableTrack(trackId = Uuid.parse(trackId), title = "Blue Monday", artist = "New Order", album = "Power, Corruption & Lies", year = 1983))!!
        assertEquals(trackId, row.id)
        assertEquals("Power, Corruption & Lies · 1983", row.detail)
    }

    @Test
    fun `a row with neither album nor year has no detail line rather than an empty one`() {
        assertNull(RequestRow.of(RequestableTrack(trackId = Uuid.parse(trackId), title = "Song", artist = "Band"))!!.detail)
        assertEquals("1983", RequestRow.of(RequestableTrack(trackId = Uuid.parse(trackId), title = "Song", artist = "Band", year = 1983))!!.detail)
    }

    @Test
    fun `blank fields are left out rather than sent empty`() {
        val body = RequestForm(name = "  ", dedicateTo = "", message = "\n").body(held)
        assertEquals(trackId, body.trackId.toString())
        assertNull(body.source)
        assertNull(body.name)
        assertNull(body.dedicateTo)
        assertNull(body.message)
    }

    @Test
    fun `fields are sent trimmed and within the station's caps`() {
        val body = RequestForm(name = " Sam ", dedicateTo = "x".repeat(80), message = "y".repeat(250)).body(held)
        assertEquals("Sam", body.name)
        assertEquals(REQUEST_DEDICATE_MAX, body.dedicateTo?.length)
        assertEquals(REQUEST_MESSAGE_MAX, body.message?.length)
    }

    private val held get() = RequestRow.of(RequestableTrack(trackId = Uuid.parse(trackId), title = "Song", artist = "Band"))!!

    @Test
    fun `a record only a provider carries is asked for by its source, and says where from`() {
        val source = RequestableSource(pluginId = "deadair.spotify", externalId = "sp-1")
        val row = RequestRow.of(RequestableTrack(source = source, sourceName = "Spotify", title = "Blueberry Hill", artist = "Fats Domino"))!!

        assertEquals("deadair.spotify:sp-1", row.id)
        assertEquals("Spotify", row.sourceName)
        val body = RequestForm().body(row)
        assertNull(body.trackId)
        assertEquals(source, body.source)
    }

    @Test
    fun `a record the station holds is asked for by its id alone, and says nothing about where from`() {
        val row = RequestRow.of(
            RequestableTrack(trackId = Uuid.parse(trackId), source = RequestableSource("deadair.spotify", "sp-1"), sourceName = "Spotify", title = "Song", artist = "Band"),
        )!!

        assertNull(row.sourceName)
        assertNull(RequestForm().body(row).source)
    }

    @Test
    fun `a row naming its record neither way is not drawn`() {
        assertNull(RequestRow.of(RequestableTrack(title = "Song", artist = "Band")))
    }

    @Test
    fun `a refusal is said in the station's words whatever the code was`() {
        val reason = "You already have a request in: Blue Monday. One at a time."
        assertEquals(Message.RequestRefused(reason), requestOutcome(request(RequestStatus.DECLINED, reason = reason)))
        assertEquals(Message.RequestRefused(null), requestOutcome(request(RequestStatus.EXPIRED)))
    }

    @Test
    fun `a request the operator must approve says so`() {
        assertEquals(Message.RequestWaiting("Blue Monday"), requestOutcome(request(RequestStatus.WAITING)))
    }

    @Test
    fun `a request the station took is on its way`() {
        assertEquals(Message.RequestOnItsWay("Blue Monday"), requestOutcome(request(RequestStatus.PENDING)))
        assertEquals(Message.RequestOnItsWay("Blue Monday"), requestOutcome(request(RequestStatus.QUEUED)))
    }

    @Test
    fun `only waiting, pending and queued are open`() {
        assertTrue(isOpen(RequestStatus.WAITING))
        assertTrue(isOpen(RequestStatus.PENDING))
        assertTrue(isOpen(RequestStatus.QUEUED))
        assertFalse(isOpen(RequestStatus.AIRED))
        assertFalse(isOpen(RequestStatus.DECLINED))
        assertFalse(isOpen(RequestStatus.EXPIRED))
    }

    @Test
    fun `an aired request says when, in the listener's zone`() {
        val now = Instant.parse("2026-10-03T22:00:00Z").toEpochMilliseconds()
        val row = MyRequestRow.of(request(RequestStatus.AIRED, airedAt = "2026-10-03T21:14:05Z"), now, ZoneOffset.UTC)
        assertEquals(Message.Aired(AiredLabel.Today(Clock(21, 14))), row.note)
    }

    @Test
    fun `a refused request says why, and an open one who it is for`() {
        val now = Instant.parse("2026-10-03T22:00:00Z").toEpochMilliseconds()
        assertEquals(Message.Text("Not tonight."), MyRequestRow.of(request(RequestStatus.DECLINED, reason = "Not tonight."), now, ZoneOffset.UTC).note)
        assertEquals(Message.RequestFor("Alex"), MyRequestRow.of(request(RequestStatus.QUEUED, dedicateTo = "Alex"), now, ZoneOffset.UTC).note)
        assertNull(MyRequestRow.of(request(RequestStatus.PENDING), now, ZoneOffset.UTC).note)
    }
}
