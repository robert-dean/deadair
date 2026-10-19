package com.maroonedsoftware.deadair.auth

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException

/**
 * The phone's passkey prompt, through Credential Manager.
 *
 * Android hands the app a passkey made at the station's host only when that host vouches for this
 * package and signing certificate in `/.well-known/assetlinks.json`, which each station serves for
 * itself. [context] has to be an activity, because the prompt is drawn over it.
 */
suspend fun askForPasskey(context: Context, requestJson: String): PasskeyAnswer =
    try {
        val response = CredentialManager.create(context).getCredential(context, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestJson))))
        when (val credential = response.credential) {
            is PublicKeyCredential -> PasskeyAnswer.Answered(credential.authenticationResponseJson)
            else -> PasskeyAnswer.Failed("Credential Manager answered with a ${credential.type}")
        }
    } catch (error: GetCredentialCancellationException) {
        PasskeyAnswer.Cancelled
    } catch (error: NoCredentialException) {
        PasskeyAnswer.NoPasskey
    } catch (error: GetCredentialException) {
        PasskeyAnswer.Failed(error.type)
    }

/**
 * This build's WebAuthn origin, from the certificate it is signed with, or null where it cannot be
 * read. Below Android 9 there is no `signingInfo` and no passkey through Credential Manager either,
 * so nothing is lost by not reading the older, spoofable `signatures` there.
 */
fun signingOrigin(context: Context): String? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
    return try {
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo
        info?.apkContentsSigners?.firstOrNull()?.toByteArray()?.let(::appOrigin)
    } catch (error: PackageManager.NameNotFoundException) {
        null
    }
}
