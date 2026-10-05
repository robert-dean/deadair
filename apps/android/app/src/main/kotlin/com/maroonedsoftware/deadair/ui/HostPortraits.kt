@file:OptIn(ExperimentalUuidApi::class)

package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.sdk.models.PersonaPortrait
import kotlin.uuid.ExperimentalUuidApi

/**
 * The portrait the station keeps for [personaId], as the station's own path: resolve it with
 * `StationUrl.artUrl` like any cover.
 *
 * Read from `GET /art/personas`, the station's list of every persona that has a picture, which is
 * the same picture Now playing's `hostArtUrl` points at. `null` for nobody, for a persona with no
 * picture, and for a blank path, so every caller draws the name alone exactly as it did before
 * portraits existed.
 *
 * The id is matched ignoring case: the contract hands the portrait's id over as a UUID, which
 * prints lowercase, and the persona list hands it over as text, which nothing promises is.
 */
fun List<PersonaPortrait>.portraitPathOf(personaId: String?): String? {
    val id = personaId?.ifBlank { null } ?: return null
    return firstOrNull { it.personaId.toString().equals(id, ignoreCase = true) }?.url?.ifBlank { null }
}
