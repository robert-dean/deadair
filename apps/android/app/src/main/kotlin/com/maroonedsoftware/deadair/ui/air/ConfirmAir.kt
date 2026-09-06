package com.maroonedsoftware.deadair.ui.air

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.maroonedsoftware.deadair.R

/**
 * Asked once, because this is the one action on the phone that changes what every listener hears
 * at a stroke rather than one record at a time. The console does not ask; a phone in a pocket has
 * a stray press the console does not.
 */
@Composable
fun ConfirmAir(what: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.air_confirm_title, what)) },
        text = { Text(stringResource(R.string.air_confirm_detail)) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(stringResource(R.string.air_it)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
