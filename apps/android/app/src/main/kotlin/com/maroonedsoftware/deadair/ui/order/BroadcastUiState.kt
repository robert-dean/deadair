package com.maroonedsoftware.deadair.ui.order

import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.StationOrder
import com.maroonedsoftware.deadair.ui.text.Message

/** Who is presenting, in the three states the answer actually has. */
sealed interface HostLine {
    /** The broadcast named somebody, and the station resolved their name as it read the order. */
    data class Named(val name: String) : HostLine

    /** The broadcast named nobody, so whoever the station has on air presents it. `null` until the persona list arrives. */
    data class StationsOwn(val name: String?) : HostLine

    /** Nobody at all: the broadcast named nobody and the station has no persona on air either. */
    data object Nobody : HostLine
}

/**
 * What the broadcast at the top of the Up next tab says about itself.
 *
 * Three facts the phone had no way to show and the console has always shown: what this broadcast is
 * called, what it was asked to play, and who is presenting it. The API's own note on `brief` says a
 * console should show it rather than only accept it.
 *
 * Off air is an ordinary state rather than an error, and the station says so by answering with an
 * order that has an empty name and no items. So an empty name is no title, and the host cannot be
 * changed, but the header is still drawn: it is where Plan lives.
 */
data class BroadcastUiState(val order: StationOrder, val personas: List<Persona>?) {
    /**
     * There is no broadcast at all.
     *
     * The station answers off air with a synthesised order rather than a 404, and what marks it is
     * an empty NAME as well as an empty list. A real broadcast that has simply run out of records
     * still has a name, a brief and a host, and is still a thing an operator can recast or replan —
     * keying this on the items alone hid those controls exactly when they were wanted.
     */
    val nothingOn: Boolean get() = order.name.isBlank() && order.items.isEmpty()

    val title: String? get() = order.name.takeIf { it.isNotBlank() }

    /** What the operator asked for, in their own words. It steers every refill, so it is worth showing. */
    val brief: String? get() = order.brief?.takeIf { it.isNotBlank() }

    val host: HostLine
        get() {
            val named = order.personaLabel?.takeIf { it.isNotBlank() }
            if (named != null) return HostLine.Named(named)
            // Before the persona list lands there is no name to give, which is a different thing
            // from there being nobody: saying "nobody" for that moment would be a lie that corrects
            // itself, and the correction is the part a reader notices.
            val known = personas ?: return HostLine.StationsOwn(null)
            return known.activeHost()?.let { HostLine.StationsOwn(it.label) } ?: HostLine.Nobody
        }

    /** The line the header draws. The station's own host is named where the name is known, exactly as the console names it. */
    val hostMessage: Message
        get() =
            when (val line = host) {
                is HostLine.Named -> Message.PresentedBy(line.name)
                is HostLine.StationsOwn -> line.name?.let(Message::PresentedBy) ?: Message.PresentedByStationsHost
                HostLine.Nobody -> Message.PresentedByNobody
            }

    /** There has to be a broadcast to recast. Off air the station is not presenting anything. */
    val canRecast: Boolean get() = !nothingOn

    /** Handing back to the station's host is offered only where the broadcast named somebody else. */
    val stationsOwnEnabled: Boolean get() = order.personaId != null

    val hostChoices: List<HostChoice> get() = hostChoicesOf(personas.orEmpty(), order.personaId)

    /** The station's own host, for the picker's first row to name. */
    val stationsOwnName: String? get() = personas?.activeHost()?.label
}
