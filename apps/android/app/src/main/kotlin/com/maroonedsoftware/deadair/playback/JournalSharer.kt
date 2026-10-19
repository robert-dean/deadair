package com.maroonedsoftware.deadair.playback

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import com.maroonedsoftware.deadair.scripts.BreakSharer
import java.io.File
import java.io.IOException
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Hands the playback journal to the share sheet, so a drop on a walk can be sent from the phone
 * that heard it rather than waiting for a cable and `adb`.
 *
 * The same directory and `FileProvider` a break's copy goes through (see [BreakSharer]), emptied
 * before each share for the same reason: nothing piles up, and the receiving app reads the file
 * after the chooser has returned, at a moment this one cannot know. The file opens with the app's
 * version and the Android release, because a log with no version on it cannot be read against the
 * code that wrote it. Nothing else about the phone goes in.
 */
class JournalSharer(private val context: Context, private val journal: PlaybackJournal) {
    /** The journal as a file ready to send, or `null` when nothing has been recorded yet (or it could not be written). */
    suspend fun prepare(): File? {
        val lines = journal.read()
        if (lines.isEmpty()) return null
        return withContext(Dispatchers.IO) {
            try {
                val dir = File(context.cacheDir, BreakSharer.SHARED_DIR)
                dir.listFiles()?.forEach { it.delete() }
                dir.mkdirs()
                File(dir, "deadair-playback-${LocalDate.now()}.txt").apply { writeText((listOf(header()) + lines).joinToString("") { it + "\n" }) }
            } catch (_: IOException) {
                null
            }
        }
    }

    /** A chooser holding the file and permission to read it. */
    fun chooser(file: File, chooserTitle: String): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}${BreakSharer.AUTHORITY_SUFFIX}", file)
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, file.name)
                clipData = ClipData.newRawUri(file.name, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        return Intent.createChooser(send, chooserTitle).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    private fun header(): String {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return "# ${context.packageName} ${info.versionName} (${PackageInfoCompat.getLongVersionCode(info)}), Android ${Build.VERSION.RELEASE}"
    }
}
