package com.maroonedsoftware.deadair.auth

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OperatorLockTest {
    private var clock = 1_000L
    private val lock = OperatorLock { clock }

    @Test
    fun `a new process starts shut`() {
        assertFalse(lock.isOpen.value)
    }

    @Test
    fun `unlocking opens it`() {
        lock.unlocked()
        assertTrue(lock.isOpen.value)
    }

    @Test
    fun `a short trip away keeps it open`() {
        lock.unlocked()
        lock.left()
        clock += OPERATOR_LOCK_GRACE_MS - 1
        lock.returned()
        assertTrue(lock.isOpen.value)
    }

    @Test
    fun `away for the whole grace shuts it`() {
        lock.unlocked()
        lock.left()
        clock += OPERATOR_LOCK_GRACE_MS
        lock.returned()
        assertFalse(lock.isOpen.value)
    }

    @Test
    fun `leaving does not shut it until the app is back`() {
        lock.unlocked()
        lock.left()
        clock += OPERATOR_LOCK_GRACE_MS * 2
        assertTrue(lock.isOpen.value)
    }

    @Test
    fun `an unlock from the passcode screen, which is itself away, stays open`() {
        lock.left()
        clock += OPERATOR_LOCK_GRACE_MS * 2
        lock.unlocked()
        lock.returned()
        assertTrue(lock.isOpen.value)
    }

    @Test
    fun `each trip is timed from its own start`() {
        lock.unlocked()
        lock.left()
        clock += OPERATOR_LOCK_GRACE_MS - 1
        lock.returned()
        lock.left()
        clock += OPERATOR_LOCK_GRACE_MS - 1
        lock.returned()
        assertTrue(lock.isOpen.value)
    }
}
