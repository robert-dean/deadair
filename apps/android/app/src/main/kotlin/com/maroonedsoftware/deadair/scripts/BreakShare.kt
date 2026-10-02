package com.maroonedsoftware.deadair.scripts

import com.maroonedsoftware.deadair.sdk.models.ScriptAttempt
import com.maroonedsoftware.deadair.sdk.models.ScriptOutcome
import com.maroonedsoftware.deadair.ui.text.Message

/**
 * The decisions behind sharing a break, free of `android.*` so the JVM tests can read them.
 *
 * The station makes the copy (`GET /segments/{id}/audio?rendition=share`, AAC sized for a text
 * message) and this app only asks for it, so what is left here is which rows can be shared, what the
 * file is called on the way out, and what to say when it does not work.
 */
object BreakShare {
    /** The name a copy gets when the station did not offer one. */
    const val FALLBACK_NAME = "deadair-break.m4a"

    /**
     * Whether a row has audio to share: words were written, and the segment they became is still
     * known. A declined or failed attempt never became audio, and a row that outlived its segment
     * has nothing to fetch.
     */
    fun shareable(attempt: ScriptAttempt): Boolean = attempt.outcome == ScriptOutcome.WRITTEN && attempt.segmentId != null

    /**
     * The file name, from the station's `content-disposition` when it sent one.
     *
     * Cleaned again here rather than trusted: it becomes a path under the cache directory, so
     * anything but letters, digits, dots, dashes and underscores goes, and a name that cleans down to
     * nothing usable falls back. An older station that ignored the rendition and sent the original
     * gets its extension from the type it actually answered.
     */
    fun fileName(contentDisposition: String?, extension: String): String {
        val offered = contentDisposition?.let { FILENAME.find(it)?.groupValues?.get(1) }
        val cleaned = offered?.replace(UNSAFE, "-")?.trim('-', '.')
        val name = if (cleaned.isNullOrEmpty() || !cleaned.contains('.')) FALLBACK_NAME else cleaned
        return "${name.substringBeforeLast('.')}.$extension"
    }

    /**
     * What to tell somebody whose share did not work, from the station's status, or `null` when the
     * station was never reached.
     */
    fun failure(status: Int?): Message =
        when (status) {
            null -> Message.ShareCouldNotReach
            404 -> Message.ShareGone
            503 -> Message.ShareCannotCopy
            else -> Message.ShareFailed
        }

    private val FILENAME = Regex("""filename="?([^";]+)"?""")
    private val UNSAFE = Regex("""[^A-Za-z0-9._-]+""")
}
