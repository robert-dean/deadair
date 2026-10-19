package com.maroonedsoftware.deadair.playback

import java.io.File
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** The playback journal: what it writes, what it keeps, and that it never stands in playback's way. */
@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackJournalTest {
    @get:Rule val folder = TemporaryFolder()

    private val utc: ZoneId = ZoneOffset.UTC

    /** 2026-10-18T17:12:54.495Z. */
    private val at = 1_792_343_574_495L

    private fun TestScope.journal(file: File, now: () -> Long, maxAgeMs: Long = PlaybackJournal.MAX_AGE_MS, maxBytes: Int = PlaybackJournal.MAX_BYTES) =
        PlaybackJournal(file, now, backgroundScope, zone = { utc }, maxAgeMs = maxAgeMs, maxBytes = maxBytes)

    @Test
    fun `a line is the time of day with its offset, then the event`() {
        assertEquals("2026-10-18T17:12:54.495Z stall uri=https://radio.example/live", PlaybackJournal.format(at, utc, "stall uri=https://radio.example/live"))
        assertEquals(
            "2026-10-18T13:12:54.495-04:00 play",
            PlaybackJournal.format(at, ZoneId.of("America/New_York"), "play"),
        )
    }

    @Test
    fun `an event with line breaks in it stays one line`() {
        // An exception's message can span lines, and a line without a stamp is dropped as torn.
        assertEquals("2026-10-18T17:12:54.495Z error causes=IOException: first second", PlaybackJournal.format(at, utc, "error causes=IOException: first\r\nsecond"))
    }

    @Test
    fun `reads the stamp back, and nothing from a line without one`() {
        assertEquals(at, PlaybackJournal.stampOf(PlaybackJournal.format(at, ZoneId.of("Europe/London"), "play")))
        assertNull(PlaybackJournal.stampOf("uri=https://radio.example/live"))
        assertNull(PlaybackJournal.stampOf(""))
    }

    @Test
    fun `trim drops what is too old and what has no stamp`() {
        val hour = 60 * 60_000L
        val lines =
            listOf(
                PlaybackJournal.format(at - 3 * hour, utc, "old"),
                "torn half a li",
                PlaybackJournal.format(at - hour, utc, "kept"),
                PlaybackJournal.format(at, utc, "newest"),
            )

        val kept = PlaybackJournal.trim(lines, at, 2 * hour, Int.MAX_VALUE)

        assertEquals(listOf(lines[2], lines[3]), kept)
    }

    @Test
    fun `trim keeps the newest lines that fit, counting each newline`() {
        val lines = List(5) { PlaybackJournal.format(at + it, utc, "event $it") }
        val each = lines[0].length + 1

        val kept = PlaybackJournal.trim(lines, at + 5, Long.MAX_VALUE / 2, 2 * each)

        assertEquals(lines.takeLast(2), kept)
    }

    @Test
    fun `records reach the file in order`() =
        runTest {
            val file = File(folder.root, "playback/journal.txt")
            val journal = journal(file, now = { at })

            journal.record("play uri=https://radio.example/live")
            journal.record("stall uri=https://radio.example/live")
            journal.record("resumed after 2400ms")
            runCurrent()

            assertEquals(
                listOf(
                    "2026-10-18T17:12:54.495Z play uri=https://radio.example/live",
                    "2026-10-18T17:12:54.495Z stall uri=https://radio.example/live",
                    "2026-10-18T17:12:54.495Z resumed after 2400ms",
                ),
                file.readLines(),
            )
        }

    @Test
    fun `what was written before survives a restart, less what has aged out`() =
        runTest {
            val file = File(folder.root, "journal.txt")
            val hour = 60 * 60_000L
            file.writeText(PlaybackJournal.format(at - 3 * hour, utc, "the day before") + "\n" + PlaybackJournal.format(at - hour, utc, "an hour ago") + "\n")

            val journal = journal(file, now = { at }, maxAgeMs = 2 * hour)
            journal.record("play")
            runCurrent()

            assertEquals(listOf("an hour ago", "play"), file.readLines().map { it.substringAfter(' ') })
        }

    @Test
    fun `a busy spell is trimmed back under the limit`() =
        runTest {
            val file = File(folder.root, "journal.txt")
            val journal = journal(file, now = { at }, maxBytes = 1_000)

            repeat(200) { journal.record("stall uri=https://radio.example/live attempt=$it") }
            runCurrent()

            val lines = file.readLines()
            assertTrue("${file.length()} bytes", file.length() <= 1_000 + 1_000 / 4)
            assertTrue(lines.last().endsWith("attempt=199"))
            assertFalse(File(folder.root, "journal.txt.tmp").exists())
        }

    @Test
    fun `a file that cannot be written is a gap, not a crash`() =
        runTest {
            // A directory where the file should be: every append fails.
            val file = folder.newFolder("journal.txt")
            val journal = journal(file, now = { at })

            journal.record("play")
            runCurrent()

            assertTrue(file.isDirectory)
        }

    @Test
    fun `reads back what is kept, oldest first, and nothing when nothing was written`() =
        runTest {
            val hour = 60 * 60_000L
            val file = File(folder.root, "journal.txt")
            val journal = journal(file, now = { at }, maxAgeMs = 2 * hour)

            assertEquals(emptyList<String>(), journal.read())

            file.writeText(
                listOf(
                    PlaybackJournal.format(at - 3 * hour, utc, "aged out"),
                    PlaybackJournal.format(at - hour, utc, "play"),
                    PlaybackJournal.format(at, utc, "stall"),
                    "torn half a li",
                ).joinToString("\n"),
            )

            assertEquals(listOf("play", "stall"), journal.read().map { it.substringAfter(' ') })
        }
}
