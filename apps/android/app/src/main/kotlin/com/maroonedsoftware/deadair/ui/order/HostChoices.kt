package com.maroonedsoftware.deadair.ui.order

import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.PersonaKind

/**
 * One persona the broadcast could be handed to.
 *
 * `name` is the persona's LABEL rather than its DJ name, because the label is what the station
 * resolves `personaLabel` from: a picker that showed the DJ name would disagree with the line above
 * it about the same person. The DJ name rides along as supporting text where it says something the
 * label does not.
 */
data class HostChoice(
    val id: String,
    val name: String,
    /** What they are introduced by on air, when that is not simply the label again. */
    val djName: String?,
    /** The station's own host, which is who presents anything that names nobody. */
    val onAir: Boolean,
    /** Already presenting this broadcast, so picking them would change nothing. */
    val current: Boolean,
)

/**
 * Who this broadcast could be handed to.
 *
 * Callers are left out. A caller phones IN to a production and is cast per programme; the contract
 * says one can never be put on air, so offering one would be offering a refusal. An absent kind is
 * a host, which is what the contract says and what most stored personas leave blank.
 */
fun hostChoicesOf(personas: List<Persona>, currentId: String?): List<HostChoice> =
    personas
        .filter { it.kind != PersonaKind.CALLER }
        .sortedBy { it.label.lowercase() }
        .map { persona ->
            HostChoice(
                id = persona.id,
                name = persona.label,
                djName = persona.djName?.takeIf { it.isNotBlank() && it != persona.label },
                onAir = persona.active,
                current = persona.id == currentId,
            )
        }

/** The station's own host: the one anything that names nobody is presented by. At most one. */
fun List<Persona>.activeHost(): Persona? = firstOrNull { it.active }
