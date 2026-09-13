@testable import DeadairCore
import Testing

/// Reading the station's clock: stamps with no zone, subtracted and never moved.
struct StationClockTests {
    @Test func measuresTheGapBetweenTwoReadings() {
        #expect(minutesBetween("2026-09-06 20:00:00", "2026-09-06 22:30:00") == 150)
    }

    @Test func measuresAcrossMidnightWhichEveryNightHas() {
        #expect(minutesBetween("2026-09-06 23:30:00", "2026-09-07 00:15:00") == 45)
    }

    @Test func measuresBackwardsAsANegativeSoABlockAlreadyOverReadsAsEnding() {
        #expect(minutesBetween("2026-09-06 22:00:00", "2026-09-06 21:00:00") == -60)
        #expect(spanOf(-60) == .ending)
    }

    @Test func takesNoNoticeOfADaylightSavingChange() {
        // The night the clocks go forward in much of Europe. On the station's clock this is two
        // hours, whatever the phone's zone does with it, because the answer is how much CLOCK.
        #expect(minutesBetween("2026-03-29 01:30:00", "2026-03-29 03:30:00") == 120)
    }

    @Test func readsNothingOutOfSomethingThatIsNotAStamp() {
        #expect(readClock("tonight") == nil)
        #expect(readClock("2026-09-06T20:00:00Z") == nil)
        #expect(readClock("2026-02-30 20:00:00") == nil)
        #expect(minutesBetween("tonight", "2026-09-06 22:00:00") == 0)
    }

    @Test func measuresALengthInTheUnitSomebodyWouldSayItIn() {
        #expect(spanOf(0) == .ending)
        #expect(spanOf(45) == .minutes(45))
        #expect(spanOf(60) == .hours(1, minutes: 0))
        #expect(spanOf(90) == .hours(1, minutes: 30))
        #expect(spanOf(1440) == .aDay)
        // A weekly block six days off: "161 h" is true and nobody can read it.
        #expect(spanOf(8640) == .days(6))
    }

    @Test func givesABlockItsHoursAndItsWeekdayOnlyWhenItIsNotToday() {
        let now = "2026-09-06 20:30:00"

        #expect(hoursOf(start: "2026-09-06 20:00:00", end: "2026-09-06 22:00:00", now: now)
            == BlockHours(from: Clock(hour: 20, minute: 0), to: Clock(hour: 22, minute: 0), day: nil))
        // 2026-09-07 is a Monday.
        #expect(hoursOf(start: "2026-09-07 09:00:00", end: "2026-09-07 11:00:00", now: now)
            == BlockHours(from: Clock(hour: 9, minute: 0), to: Clock(hour: 11, minute: 0), day: .monday))
    }

    @Test func givesNoHoursAtAllForAStampItCannotRead() {
        #expect(hoursOf(start: "soon", end: "2026-09-06 22:00:00", now: "2026-09-06 20:30:00") == nil)
    }
}
