package com.maroonedsoftware.deadair.catalog

import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.director.OrderRepository
import com.maroonedsoftware.deadair.sdk.models.RateInput
import com.maroonedsoftware.deadair.sdk.models.Rating
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * The operator's marks on the library, from the phone.
 *
 * A rating here is the same curation mark the console makes, with the same consequence: it changes
 * how often the station plays the record. The running order is asked to read again straight after,
 * because its rows carry the rating and the row the operator just marked is the one they are
 * looking at.
 */
@OptIn(ExperimentalUuidApi::class)
class CatalogActions(private val actions: OperatorActions, private val order: OrderRepository) {
    suspend fun rateTrack(trackId: String, rating: Rating): Boolean {
        val answered = actions.run { it.catalog.rateTrack(Uuid.parse(trackId), RateInput(rating = rating)) } != null
        if (answered) order.refetchSoon(listOf(0L))
        return answered
    }
}
