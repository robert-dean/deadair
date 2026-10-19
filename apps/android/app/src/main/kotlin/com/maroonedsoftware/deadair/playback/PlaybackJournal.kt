package com.maroonedsoftware.deadair.playback

import java.io.File
import java.io.IOException
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/**
 * What happened to playback, kept on the phone for long enough to be read after the fact.
 *
 * `PlaybackLog` writes to logcat, and logcat is not where a drop can be found later: the Pixel's
 * buffers held about seven minutes on 2026-10-19, and the drops worth explaining happen on a walk,
 * away from any computer, as wifi fades. The phone's audio history showed five restarts in six
 * minutes on 2026-10-18 and nothing anywhere said why. So the same events are appended here, one
 * timestamped line each, to a file that survives the process and is trimmed to the last
 * [maxAgeMs] or [maxBytes], whichever is smaller.
 *
 * [record] never blocks and never throws: it stamps the line with the wall clock (a person reads
 * it as a time of day) and hands it to one writer coroutine on [scope], which owns the file. A
 * journal that cannot write is a journal with a gap, never a reason for playback to stop, so an
 * `IOException` is swallowed. Pure JVM, no `android.*`, so the tests run it against a real file.
 */
class PlaybackJournal(
    private val file: File,
    private val now: () -> Long,
    scope: CoroutineScope,
    private val zone: () -> ZoneId = ZoneId::systemDefault,
    private val maxAgeMs: Long = MAX_AGE_MS,
    private val maxBytes: Int = MAX_BYTES,
) {
    private val pending = Channel<String>(Channel.UNLIMITED)

    init {
        scope.launch {
            quietly { rewrite() }
            for (line in pending) {
                quietly {
                    file.parentFile?.mkdirs()
                    file.appendText(line + "\n")
                    // Trimmed only once it is well over, so a busy spell rewrites the file now and
                    // then rather than on every line.
                    if (file.length() > maxBytes + maxBytes / 4) rewrite()
                }
            }
        }
    }

    /** Add one event. Callable from any thread. */
    fun record(event: String) {
        pending.trySend(format(now(), zone(), event))
    }

    /** Keep what [trim] keeps, through a temporary file so a crash mid-write cannot lose the lot. */
    private fun rewrite() {
        if (!file.exists()) return
        val kept = trim(file.readLines(), now(), maxAgeMs, maxBytes)
        val next = File(file.path + ".tmp")
        next.writeText(kept.joinToString("") { it + "\n" })
        if (!next.renameTo(file)) next.delete()
    }

    private inline fun quietly(block: () -> Unit) {
        try {
            block()
        } catch (_: IOException) {
        }
    }

    companion object {
        /** Two days: a walk yesterday evening is still there to share the next morning. */
        const val MAX_AGE_MS = 48 * 60 * 60_000L

        /** Thousands of lines, and still nothing a phone would notice. */
        const val MAX_BYTES = 256 * 1024

        private val STAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX")

        /** `2026-10-18T17:12:54.495-04:00 <event>`, on one line whatever the event held. */
        fun format(atMs: Long, zone: ZoneId, event: String): String =
            "${STAMP.format(Instant.ofEpochMilli(atMs).atZone(zone))} ${event.replace(Regex("[\r\n]+"), " ")}"

        /** When a line was written, or `null` for one that does not start with a stamp (a torn write). */
        fun stampOf(line: String): Long? =
            try {
                OffsetDateTime.parse(line.substringBefore(' '), STAMP).toInstant().toEpochMilli()
            } catch (_: DateTimeParseException) {
                null
            }

        /**
         * The lines worth keeping: none older than [maxAgeMs], none without a stamp, and then the
         * newest that fit in [maxBytes] (counting each line's newline).
         */
        fun trim(lines: List<String>, nowMs: Long, maxAgeMs: Long, maxBytes: Int): List<String> {
            val cutoff = nowMs - maxAgeMs
            val fresh = lines.filter { line -> stampOf(line)?.let { it >= cutoff } == true }
            var bytes = fresh.sumOf { it.toByteArray().size + 1 }
            var start = 0
            while (bytes > maxBytes && start < fresh.size) {
                bytes -= fresh[start].toByteArray().size + 1
                start += 1
            }
            return fresh.subList(start, fresh.size)
        }
    }
}
