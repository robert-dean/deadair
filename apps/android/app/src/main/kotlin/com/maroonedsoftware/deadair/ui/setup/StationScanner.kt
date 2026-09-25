package com.maroonedsoftware.deadair.ui.setup

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * A way to scan the station's code, or `null` on a phone that cannot.
 *
 * Google's code scanner rather than a viewfinder of this app's own: Play services draws the camera,
 * so the app asks for no camera permission and never sees a frame, only the text of the code. The
 * price is that it needs Play services, so a phone without it gets no button (`null`) rather than
 * one that fails, and typing the address still works there. The scanning module is fetched by Play
 * services on install (the manifest's `com.google.mlkit.vision.DEPENDENCIES`); a scan asked for
 * before it has arrived fails, and [onFailed] says so rather than the button doing nothing.
 *
 * Backing out of the scanner is neither: it is somebody changing their mind.
 */
@Composable
fun rememberStationScanner(onScanned: (String) -> Unit, onFailed: () -> Unit): (() -> Unit)? {
    val context = LocalContext.current
    val available = remember { GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS }
    val scanned by rememberUpdatedState(onScanned)
    val failed by rememberUpdatedState(onFailed)
    if (!available) return null
    return remember(context) {
        {
            val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
            GmsBarcodeScanning.getClient(context, options)
                .startScan()
                .addOnSuccessListener { code -> code.rawValue?.let { scanned(it) } }
                .addOnFailureListener { failed() }
        }
    }
}
