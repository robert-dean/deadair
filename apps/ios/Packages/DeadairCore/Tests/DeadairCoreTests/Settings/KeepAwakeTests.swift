@testable import DeadairCore
import Testing

/// When Now playing holds the screen on. `apps/android`'s `KeepAwakeTest`, case for case.
struct KeepAwakeTests {
    @Test func neverHoldsItWhateverElseIsTrue() {
        #expect(!KeepAwake.never.holdsScreen(charging: true, playing: true, inFront: true))
    }

    @Test func alwaysHoldsItOnTheBattery() {
        #expect(KeepAwake.always.holdsScreen(charging: false, playing: true, inFront: true))
    }

    @Test func whileChargingHoldsItOnPower() {
        #expect(KeepAwake.whileCharging.holdsScreen(charging: true, playing: true, inFront: true))
    }

    @Test func whileChargingLetsItSleepOnTheBattery() {
        #expect(!KeepAwake.whileCharging.holdsScreen(charging: false, playing: true, inFront: true))
    }

    @Test func nothingPlayingOnThisPhoneLetsItSleepEvenSetToAlways() {
        #expect(!KeepAwake.always.holdsScreen(charging: true, playing: false, inFront: true))
    }

    @Test func nowPlayingBehindSomethingElseLetsItSleepEvenSetToAlways() {
        #expect(!KeepAwake.always.holdsScreen(charging: true, playing: true, inFront: false))
    }
}
