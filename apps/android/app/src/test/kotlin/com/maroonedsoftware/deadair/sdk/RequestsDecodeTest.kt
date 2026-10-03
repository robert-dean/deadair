package com.maroonedsoftware.deadair.sdk

import com.maroonedsoftware.deadair.sdk.models.ListenerRequest
import com.maroonedsoftware.deadair.sdk.models.ListenerRequestList
import com.maroonedsoftware.deadair.sdk.models.RequestSource
import com.maroonedsoftware.deadair.sdk.models.RequestStatus
import com.maroonedsoftware.deadair.sdk.models.RequestableTrackList
import com.maroonedsoftware.deadair.sdk.runtime.SdkJson
import kotlin.time.Instant
import kotlin.uuid.ExperimentalUuidApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * That the generated SDK decodes what the request routes actually answer.
 *
 * The fixtures are the shapes `toListenerRequest` and the request search produce: optional fields
 * ABSENT rather than null, a refusal as an ordinary request with `declined` and a reason, and a
 * search row with no album or year, which is the shape a record from a provider arrives in.
 */
@OptIn(ExperimentalUuidApi::class)
class RequestsDecodeTest {
    @Test
    fun `decodes search results with and without the catalog's details`() {
        val json =
            """
            {
              "tracks": [
                { "trackId": "5b0e8a52-3c1f-4d2a-9e7b-0f6c1d2e3a4b", "title": "Blue Monday", "artist": "New Order", "album": "Power, Corruption & Lies", "year": 1983 },
                { "trackId": "1a2b3c4d-0000-4000-8000-000000000003", "title": "An Unknown Record", "artist": "Earth, Wind & Fire" }
              ]
            }
            """.trimIndent()

        val list = SdkJson.decodeFromString(RequestableTrackList.serializer(), json)

        assertEquals("5b0e8a52-3c1f-4d2a-9e7b-0f6c1d2e3a4b", list.tracks[0].trackId.toString())
        assertEquals(1983L, list.tracks[0].year)
        assertNull(list.tracks[1].album)
        assertNull(list.tracks[1].year)
    }

    @Test
    fun `decodes a refusal, which is a request like any other`() {
        val json =
            """
            {
              "id": "0c9f3e1a-7b2d-4e8f-a1c3-5d6e7f809a1b",
              "status": "declined",
              "title": "Blue Monday",
              "artist": "New Order",
              "requesterName": "a listener",
              "source": "app",
              "createdAt": "2026-10-03T20:00:00.000Z",
              "reason": "You already have a request in: Temptation. One at a time."
            }
            """.trimIndent()

        val request = SdkJson.decodeFromString(ListenerRequest.serializer(), json)

        assertEquals(RequestStatus.DECLINED, request.status)
        assertEquals(RequestSource.APP, request.source)
        assertEquals("You already have a request in: Temptation. One at a time.", request.reason)
        assertNull(request.airedAt)
        assertNull(request.dedicateTo)
    }

    @Test
    fun `decodes my requests, aired and dedicated`() {
        val json =
            """
            {
              "requests": [
                {
                  "id": "0c9f3e1a-7b2d-4e8f-a1c3-5d6e7f809a1b",
                  "status": "aired",
                  "title": "Blue Monday",
                  "artist": "New Order",
                  "requesterName": "Sam",
                  "source": "app",
                  "createdAt": "2026-10-03T20:00:00.000Z",
                  "airedAt": "2026-10-03T20:09:31.000Z",
                  "dedicateTo": "Alex",
                  "message": "Happy birthday"
                }
              ]
            }
            """.trimIndent()

        val request = SdkJson.decodeFromString(ListenerRequestList.serializer(), json).requests.single()

        assertEquals(RequestStatus.AIRED, request.status)
        assertEquals(Instant.parse("2026-10-03T20:09:31.000Z"), request.airedAt)
        assertEquals("Alex", request.dedicateTo)
        assertEquals("Happy birthday", request.message)
    }
}
