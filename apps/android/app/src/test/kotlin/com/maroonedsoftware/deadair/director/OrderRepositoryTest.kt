package com.maroonedsoftware.deadair.director

import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.sdk.models.StationOrder
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class OrderRepositoryTest {
    private fun order(name: String) =
        StationOrder(name = name, mode = StationMode.entries.first(), onEnd = StationOnEnd.entries.first(), source = "director", items = emptyList())

    @Test
    fun `polls every five seconds while signed in`() = runTest {
        var reads = 0
        val repository =
            OrderRepository(
                session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com")),
                read = {
                    reads += 1
                    order("polled")
                },
                nowEpochMs = { 0L },
                scope = backgroundScope,
            )
        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(OrderRepository.POLL_MS * 2 + 1)

        assertEquals(3, reads)
        job.cancel()
    }

    @Test
    fun `an applied order shows at once and the refill follow-ups read again`() = runTest {
        var reads = 0
        val repository =
            OrderRepository(
                session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com")),
                read = {
                    reads += 1
                    order("polled")
                },
                nowEpochMs = { 0L },
                scope = backgroundScope,
            )
        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)

        repository.apply(order("applied"))
        advanceTimeBy(1)
        assertEquals("applied", (repository.state.value as OrderState.Loaded).order.name)

        repository.refetchSoon(OrderRepository.REFILL_FOLLOW_UP_MS)
        advanceTimeBy(8_001)
        // 1.5 s, 4 s and 8 s from the ask, each of which restarts the five-second wait; no regular poll fits between.
        assertEquals(4, reads)
        assertEquals("polled", (repository.state.value as OrderState.Loaded).order.name)
        job.cancel()
    }
}
