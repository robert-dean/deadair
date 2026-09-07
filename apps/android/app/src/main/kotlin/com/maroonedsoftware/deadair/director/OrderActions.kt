package com.maroonedsoftware.deadair.director

import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.models.AddStationTrackInput
import com.maroonedsoftware.deadair.sdk.models.ExtendStationInput
import com.maroonedsoftware.deadair.sdk.models.MoveStationItemInput
import com.maroonedsoftware.deadair.sdk.models.SetStationHostInput
import com.maroonedsoftware.deadair.sdk.models.StationOrder
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * What an operator can do to the running order from the phone.
 *
 * Every action but Extend answers with the order it produced, which goes on screen at once. Extend
 * answers 202 and nothing: the refill lands at the station's own pace, which is what the longer
 * follow-up reads are for.
 */
@OptIn(ExperimentalUuidApi::class)
class OrderActions(private val actions: OperatorActions, private val order: OrderRepository) {
    /** Ask for more records now, without waiting for the order to run low. Answers whether the station took the request. */
    suspend fun extend(): Boolean {
        val accepted = actions.run { it.director.extendTheRunningOrder(ExtendStationInput()) } != null
        if (accepted) order.refetchSoon(OrderRepository.REFILL_FOLLOW_UP_MS)
        return accepted
    }

    /** Reorder everything the player is not already holding. */
    suspend fun shuffle() = applying { it.director.shuffleTheRunningOrder() }

    /**
     * Take an item out. A record is spliced out entirely and can be put back with `restore`; a break
     * is only marked removed, so the station does not plant another into the same slot a minute later.
     */
    suspend fun remove(itemId: String): Boolean = applying { it.director.removeARunningOrderItem(itemId) }

    /** Undo's other half: put a dropped record back where it was. The station may refuse an index the player has passed. */
    suspend fun restore(trackId: String, atIndex: Int): Boolean =
        applying { it.director.addARecordToTheRunningOrder(AddStationTrackInput(trackId = Uuid.parse(trackId), atIndex = atIndex.toLong())) }

    /** Move an item to a position. The station refuses anything below what the player holds rather than clamping it. */
    suspend fun move(itemId: String, toIndex: Int): Boolean =
        applying { it.director.moveARunningOrderItem(itemId, MoveStationItemInput(toIndex = toIndex.toLong())) }

    /**
     * Hand the broadcast to somebody else, or `null` to hand it back to the station's own host.
     *
     * Breaks already written in the outgoing character are written again in the new one, so this is
     * a change to what the station will SAY as well as to a name on a card. The air reading is not
     * re-read: `StationAir` carries no host, and the order this answers with is the one that does.
     */
    suspend fun recast(personaId: String?): Boolean =
        applying(expected = mapOf(NOT_FOUND to Notice.HostGone)) { it.director.recastTheBroadcast(SetStationHostInput(personaId = personaId)) }

    private suspend fun applying(expected: Map<Int, Notice> = emptyMap(), action: suspend (DeadairSdk) -> StationOrder): Boolean {
        val answer = actions.run(expected = expected, action = action) ?: return false
        order.apply(answer)
        order.refetchSoon()
        return true
    }

    private companion object {
        /** The station validates the persona at the door, so an id from a list it has since changed comes back as this. */
        const val NOT_FOUND = 404
    }
}
