package com.maroonedsoftware.deadair.auth

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import com.maroonedsoftware.deadair.sdk.models.PlatformRole
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.sessionPreferences: DataStore<Preferences> by preferencesDataStore(name = "session")

/**
 * The session, on disk.
 *
 * ## Why a second file rather than two more keys in `listener`
 *
 * Different lifetimes. The settings are edited by a person and outlive everything; a session is
 * cleared on sign-out and again whenever the station changes, and is the one thing here that is
 * worth deleting rather than correcting. Keeping them apart means `SettingsStore` stays what its
 * own documentation says it is, and a `clear()` here cannot take the station address with it.
 *
 * ## Why the tokens are not encrypted
 *
 * The file is app-private, `android:allowBackup="false"` keeps it out of cloud backup, and
 * `data_extraction_rules.xml` excludes the whole root from a device-to-device transfer as well — so
 * the token does not leave this phone. Jetpack's `security-crypto` is deprecated and would add a
 * key that lives in the same place the file does: anything with the reach to read app-private
 * storage on a rooted device can read the keystore-wrapped copy too. That is a real limit and it is
 * stated rather than papered over. The token is a bearer for one station's `platform.view`, and it
 * is the operator's own account, which is why signing in is optional and listening needs none.
 */
class SessionStore(private val context: Context) : SessionStorage {
    override val stored: Flow<StoredSession?> =
        context.sessionPreferences.data.map { saved ->
            val origin = saved[ORIGIN]
            val email = saved[EMAIL]
            val access = saved[ACCESS_TOKEN]
            val refresh = saved[REFRESH_TOKEN]

            // All four or nothing. A half-written session is not something to repair — the refresh
            // token is single-use, so a session missing one of its halves is already spent — and
            // treating it as absent puts the listener back on the sign-in form, which is where they
            // can fix it.
            if (origin == null || email == null || access == null || refresh == null) {
                null
            } else {
                StoredSession(
                    origin = origin,
                    email = email,
                    accessToken = access,
                    refreshToken = refresh,
                    // Absent means none, never a missing session: the roles arrive one request
                    // after the tokens do, and a session is a session before they land. A name
                    // this build does not know is dropped rather than crashing the read, which is
                    // what a station newer than the app looks like.
                    roles = saved[ROLES].orEmpty().mapNotNullTo(HashSet()) { name -> PlatformRole.entries.firstOrNull { it.name == name } },
                )
            }
        }

    override suspend fun save(session: StoredSession) {
        context.sessionPreferences.edit { saved ->
            saved[ORIGIN] = session.origin
            saved[EMAIL] = session.email
            saved[ACCESS_TOKEN] = session.accessToken
            saved[REFRESH_TOKEN] = session.refreshToken
            saved[ROLES] = session.roles.mapTo(HashSet()) { it.name }
        }
    }

    override suspend fun clear() {
        context.sessionPreferences.edit { it.clear() }
    }

    private companion object {
        val ORIGIN = stringPreferencesKey("origin")
        val EMAIL = stringPreferencesKey("email")
        val ACCESS_TOKEN = stringPreferencesKey("access_token")
        val REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        val ROLES = stringSetPreferencesKey("roles")
    }
}
