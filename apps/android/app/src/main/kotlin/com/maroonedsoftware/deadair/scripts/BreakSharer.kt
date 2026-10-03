package com.maroonedsoftware.deadair.scripts

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.maroonedsoftware.deadair.auth.NotSignedInException
import com.maroonedsoftware.deadair.auth.OperatorSession
import com.maroonedsoftware.deadair.sdk.clients.GetSegmentAudioResponse
import com.maroonedsoftware.deadair.sdk.models.SegmentAudioQuery
import com.maroonedsoftware.deadair.sdk.models.SegmentAudioRendition
import com.maroonedsoftware.deadair.sdk.runtime.SdkError
import com.maroonedsoftware.deadair.ui.text.Message
import java.io.File
import java.io.IOException
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The station's small copy of a break, written to the cache and ready to send or save. */
data class BreakCopy(val file: File, val mime: String)

/** What came of fetching a break's copy. */
sealed interface BreakShareOutcome {
    data class Ready(val copy: BreakCopy) : BreakShareOutcome

    data class Failed(val why: Message) : BreakShareOutcome
}

/**
 * Fetches the station's shareable copy of a break, then hands it to the share sheet or saves it
 * wherever the person picks.
 *
 * The copy is written under `cacheDir/shared/` and offered through a `FileProvider`, which is the
 * only way to hand another app a file this one owns. **That directory never holds more than one**:
 * it is emptied before each share, so nothing accumulates however many breaks somebody sends, and
 * Android may clear it under storage pressure anyway. Emptying before rather than after is
 * deliberate: the app receiving the file reads it after the chooser returns, at a moment this one
 * cannot know.
 */
@OptIn(ExperimentalUuidApi::class)
class BreakSharer(private val context: Context, private val session: OperatorSession) {
    /** Fetches the copy and writes it to the cache, where [chooser] and [saveTo] both read it. */
    suspend fun fetch(segmentId: String): BreakShareOutcome {
        val copy =
            try {
                session.withSession { it.render.getSegmentAudio(Uuid.parse(segmentId), SegmentAudioQuery(rendition = SegmentAudioRendition.SHARE)) }
            } catch (error: SdkError) {
                return BreakShareOutcome.Failed(BreakShare.failure(error.status))
            } catch (_: NotSignedInException) {
                return BreakShareOutcome.Failed(Message.ShareFailed)
            } catch (_: IOException) {
                return BreakShareOutcome.Failed(BreakShare.failure(null))
            }

        val (bytes, mime, extension, disposition) =
            when (copy) {
                is GetSegmentAudioResponse.Status200AudioMp4 -> Received(copy.data, "audio/mp4", "m4a", copy.headers.contentDisposition)
                is GetSegmentAudioResponse.Status200AudioMpeg -> Received(copy.data, "audio/mpeg", "mp3", copy.headers.contentDisposition)
                is GetSegmentAudioResponse.Status200AudioWav -> Received(copy.data, "audio/wav", "wav", copy.headers.contentDisposition)
                is GetSegmentAudioResponse.Status200AudioOgg -> Received(copy.data, "audio/ogg", "ogg", copy.headers.contentDisposition)
                is GetSegmentAudioResponse.Status200AudioFlac -> Received(copy.data, "audio/flac", "flac", copy.headers.contentDisposition)
                // Never asked for: the app sends no validator.
                GetSegmentAudioResponse.Status304 -> return BreakShareOutcome.Failed(Message.ShareFailed)
            }

        val file =
            try {
                withContext(Dispatchers.IO) {
                    val dir = File(context.cacheDir, SHARED_DIR)
                    dir.listFiles()?.forEach { it.delete() }
                    dir.mkdirs()
                    File(dir, BreakShare.fileName(disposition, extension)).apply { writeBytes(bytes) }
                }
            } catch (_: IOException) {
                return BreakShareOutcome.Failed(Message.ShareFailed)
            }

        return BreakShareOutcome.Ready(BreakCopy(file, mime))
    }

    /** A chooser holding the copy and permission to read it. */
    fun chooser(copy: BreakCopy, chooserTitle: String): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}$AUTHORITY_SUFFIX", copy.file)
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = copy.mime
                putExtra(Intent.EXTRA_STREAM, uri)
                // ClipData as well as the extra: it is what carries the read grant through the chooser
                // to whichever app is picked.
                clipData = ClipData.newRawUri(copy.file.name, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        return Intent.createChooser(send, chooserTitle).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    /**
     * Copies the copy into the document the person created through the system's save dialog, and
     * answers whether it got there.
     *
     * The save dialog rather than writing into Downloads ourselves: it needs no storage permission on
     * any version this app runs on (writing to shared storage before Android 10 does), and the person
     * chooses the folder and the name rather than finding the file wherever the app decided.
     */
    suspend fun saveTo(copy: BreakCopy, destination: Uri): Boolean =
        withContext(Dispatchers.IO) {
            try {
                val out = context.contentResolver.openOutputStream(destination) ?: return@withContext false
                out.use { copy.file.inputStream().use { input -> input.copyTo(it) } }
                true
            } catch (_: IOException) {
                false
            } catch (_: SecurityException) {
                false
            }
        }

    private data class Received(val data: ByteArray, val mime: String, val extension: String, val disposition: String?)

    companion object {
        /** Under `cacheDir`, and named in `res/xml/share_paths.xml`. */
        const val SHARED_DIR = "shared"

        /** After the package name, so the `.debug` copy and the Play build never claim the same authority. */
        const val AUTHORITY_SUFFIX = ".shares"
    }
}
