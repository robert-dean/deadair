package com.maroonedsoftware.deadair.ui.setup

import org.junit.Assert.assertEquals
import org.junit.Test

/** Where setup opens: the welcome on a first run, the field when a link has already filled it. */
class SetupStepTest {
    @Test
    fun `a first run opens on the welcome`() {
        assertEquals(SetupStep.WELCOME, SetupStep.initial(proposing = false))
    }

    @Test
    fun `a link opens on the address it filled in`() {
        assertEquals(SetupStep.STATION, SetupStep.initial(proposing = true))
    }
}
