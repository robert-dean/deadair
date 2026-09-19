package com.maroonedsoftware.deadair.ui.catalog

import com.maroonedsoftware.deadair.sdk.models.TrackBinding
import com.maroonedsoftware.deadair.sdk.models.TrackDetail
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * Whether a record page offers the add. The station refuses a record whose audio is not here, and a
 * button that can only be refused is worse than a disabled one with its reason beside it.
 */
@OptIn(ExperimentalUuidApi::class)
class LocalAudioTest {
    private fun copy(byteSize: Long?) =
        TrackBinding(
            sourceId = Uuid.random(),
            pluginId = "navidrome",
            externalId = "x",
            playable = true,
            origin = "sync",
            attempts = if (byteSize == null) 2L else 0L,
            byteSize = byteSize,
        )

    private fun record(vararg copies: TrackBinding) =
        TrackDetail(
            id = Uuid.random(),
            title = "Song",
            artistId = Uuid.random(),
            artistName = "Band",
            artists = "Band",
            bindings = copies.toList(),
            plays = emptyList(),
            playCount = 0L,
        )

    @Test
    fun `a record with no copies has nothing here`() {
        assertFalse(record().hasLocalAudio())
    }

    @Test
    fun `copies that were never fetched, or failed, are not audio`() {
        assertFalse(record(copy(null), copy(null)).hasLocalAudio())
    }

    @Test
    fun `one fetched copy among several is enough`() {
        assertTrue(record(copy(null), copy(4_200_000L)).hasLocalAudio())
    }
}
