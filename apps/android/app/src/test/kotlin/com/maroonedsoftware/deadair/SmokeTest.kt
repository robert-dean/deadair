package com.maroonedsoftware.deadair

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * One assertion, so `testDebugUnitTest` has something to run from the first commit and the CI job
 * that calls it is proven to be wired rather than merely present.
 *
 * The identity it checks is not arbitrary: an `applicationId` cannot be changed once anything has
 * installed the app, so pinning it here makes a rename a deliberate act rather than a typo.
 */
class SmokeTest {
    @Test
    fun `the application id is the one the station publishes under`() {
        assertEquals("com.maroonedsoftware.deadair", BuildConfig.APPLICATION_ID)
    }
}
