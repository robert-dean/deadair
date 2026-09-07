package com.maroonedsoftware.deadair.playout

import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.director.OrderRepository
import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.models.PlayoutChartInput
import com.maroonedsoftware.deadair.sdk.models.PlayoutChartInputChartOrder
import com.maroonedsoftware.deadair.sdk.models.PlayoutPlaylistInput
import com.maroonedsoftware.deadair.sdk.models.PlayoutStatus
import com.maroonedsoftware.deadair.sdk.models.PutOnAirInput
import com.maroonedsoftware.deadair.sdk.models.StationAir

/**
 * Putting something on air from the phone.
 *
 * A broadcast action, not a preview: it replaces whatever was queued and goes out over the mount
 * to every listener. The station answers with the status it produced, which goes on screen at
 * once, and the running order is asked to read again because it has just been rebuilt.
 */
class AirActions(private val actions: OperatorActions, private val playout: PlayoutRepository, private val order: OrderRepository) {
    suspend fun airPlaylist(pluginId: String, playlistId: String): Boolean =
        air { it.playout.playAPlaylist(PlayoutPlaylistInput(pluginId = pluginId, playlistId = playlistId)) }

    suspend fun airChart(chartId: String, chartOrder: PlayoutChartInputChartOrder): Boolean =
        air { it.playout.playAChart(PlayoutChartInput(chartId = chartId, chartOrder = chartOrder)) }

    /**
     * Put the station on air on a running order built from the operator's own words.
     *
     * The other two air a document the station already has; this one mints a broadcast and has the
     * station programme it, so it answers with the AIR reading rather than a playout status, and
     * the records arrive at the model's pace — which is what the longer follow-up reads on the
     * order are for. What is playing finishes: changing the programming is not a reason to cut a
     * listener off mid-track.
     */
    suspend fun goOnAir(input: PutOnAirInput): Boolean {
        val answer: StationAir = actions.run { it.director.putTheStationOnAir(input) } ?: return false
        playout.applyAir(answer)
        playout.refetchSoon()
        order.refetchSoon(OrderRepository.REFILL_FOLLOW_UP_MS)
        return true
    }

    private suspend fun air(action: suspend (DeadairSdk) -> PlayoutStatus): Boolean {
        // 422 is the station saying there is nothing it can play in what it was handed.
        val answer = actions.run(expected = mapOf(UNPROCESSABLE to Notice.PlaylistEmpty), action = action) ?: return false
        playout.apply(answer)
        playout.refetchSoon()
        order.refetchSoon(OrderRepository.REFILL_FOLLOW_UP_MS)
        return true
    }

    private companion object {
        const val UNPROCESSABLE = 422
    }
}
