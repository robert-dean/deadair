package com.maroonedsoftware.deadair.ui.schedule

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.PreviewLightDark
import com.maroonedsoftware.deadair.schedule.ScheduleReading
import com.maroonedsoftware.deadair.schedule.ScheduleState
import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.ScheduleNow
import com.maroonedsoftware.deadair.sdk.models.ScheduleOccurrence
import com.maroonedsoftware.deadair.sdk.models.ScheduleSlot
import com.maroonedsoftware.deadair.sdk.models.ScheduleSlotMode
import com.maroonedsoftware.deadair.sdk.models.ScheduleSlotOnEnd
import com.maroonedsoftware.deadair.ui.theme.DeadairTheme

private val slots =
    listOf(
        ScheduleSlot(id = "s1", label = "Late Night", startsAtMinutes = 1200, endsAtMinutes = 1320, personaId = "p1", brief = "slow records", mode = ScheduleSlotMode.ROTATION, onEnd = ScheduleSlotOnEnd.EXTEND),
        ScheduleSlot(id = "s2", label = "Small Hours", startsAtMinutes = 1320, endsAtMinutes = 1440, mode = ScheduleSlotMode.ROTATION, onEnd = ScheduleSlotOnEnd.EXTEND),
    )
private val personas = listOf(Persona(id = "p1", key = "cass", label = "Night persona", style = "warm", djName = "Cass", active = true))

private fun reading(now: ScheduleNow) = ScheduleReading(now = now, slots = slots, personas = personas)

private val liveNow =
    ScheduleNow(
        now = "2026-09-06 20:30:00",
        slotId = "s1",
        airingSlotId = "s1",
        upcoming =
            listOf(
                ScheduleOccurrence("s1", "Late Night", "2026-09-06 20:00:00", "2026-09-06 22:00:00"),
                ScheduleOccurrence("s2", "Small Hours", "2026-09-06 22:00:00", "2026-09-07 00:00:00"),
                ScheduleOccurrence("s1", "Late Night", "2026-09-07 20:00:00", "2026-09-07 22:00:00"),
            ),
    )

@Composable
private fun Framed(state: ScheduleState) {
    DeadairTheme { Surface { WhatsOnScreen(state, onRetry = {}, onSettings = {}) } }
}

@PreviewLightDark
@Composable
private fun LivePreview() = Framed(ScheduleState.Answered(reading(liveNow)))

@PreviewLightDark
@Composable
private fun TakenOverPreview() = Framed(ScheduleState.Answered(reading(liveNow.copy(airingSlotId = null))))

@PreviewLightDark
@Composable
private fun BetweenBlocksPreview() =
    Framed(ScheduleState.Answered(reading(ScheduleNow(now = "2026-09-06 19:00:00", upcoming = liveNow.upcoming))))

@PreviewLightDark
@Composable
private fun NothingDuePreview() = Framed(ScheduleState.Answered(reading(ScheduleNow(now = "2026-09-06 19:00:00", upcoming = emptyList()))))

@PreviewLightDark
@Composable
private fun StalePreview() = Framed(ScheduleState.Unreachable(reading(liveNow), lastGoodAtMs = 1_800_000_000_000L))
