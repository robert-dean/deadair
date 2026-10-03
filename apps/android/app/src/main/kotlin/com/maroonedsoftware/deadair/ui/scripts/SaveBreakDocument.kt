package com.maroonedsoftware.deadair.ui.scripts

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.result.contract.ActivityResultContract
import com.maroonedsoftware.deadair.scripts.BreakCopy

/**
 * The system's save dialog, for a break's copy: the person picks the folder and can change the name,
 * and the app is handed a document to write into.
 *
 * Its own contract rather than `ActivityResultContracts.CreateDocument`, which fixes the type when the
 * launcher is made. The type is not known until the station answers, and an older station that
 * ignores the rendition answers something other than `audio/mp4`.
 */
class SaveBreakDocument : ActivityResultContract<BreakCopy, Uri?>() {
    override fun createIntent(context: Context, input: BreakCopy): Intent =
        Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(input.mime).putExtra(Intent.EXTRA_TITLE, input.file.name)

    override fun parseResult(resultCode: Int, intent: Intent?): Uri? = intent.takeIf { resultCode == android.app.Activity.RESULT_OK }?.data
}
