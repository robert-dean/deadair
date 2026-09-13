@testable import DeadairCore
import Foundation
import Testing

/// When a record aired, as a listener reads it, in the listener's own zone.
struct AiredLabelTests {
    private func calendar(_ zone: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone)!
        return calendar
    }

    /// 2026-09-10 (a Thursday) at 12:00 UTC.
    private let now = Date(timeIntervalSince1970: 1_789_041_600)

    private func hoursAgo(_ hours: Double) -> Date { now.addingTimeInterval(-hours * 3600) }

    @Test func todayIsJustTheClock() {
        #expect(airedLabel(hoursAgo(2), now: now, calendar: calendar("UTC")) == .today(Clock(hour: 10, minute: 0)))
    }

    @Test func yesterdaySaysSo() {
        #expect(airedLabel(hoursAgo(24), now: now, calendar: calendar("UTC")) == .yesterday(Clock(hour: 12, minute: 0)))
    }

    @Test func insideTheWeekAWeekdayStillIdentifiesTheDay() {
        // Three days before a Thursday is a Monday.
        #expect(airedLabel(hoursAgo(72), now: now, calendar: calendar("UTC")) == .weekday(.monday, Clock(hour: 12, minute: 0)))
    }

    @Test func pastAWeekAWeekdayStopsIdentifyingAnything() {
        #expect(airedLabel(hoursAgo(24 * 9), now: now, calendar: calendar("UTC")) == .onDate(year: 2026, month: 9, day: 1))
    }

    @Test func readsTheInstantInTheZoneItIsShownIn() {
        // One moment, two listeners: 10:00 in London is 19:00 in Tokyo, and each should read their own.
        #expect(airedLabel(hoursAgo(2), now: now, calendar: calendar("Europe/London")) == .today(Clock(hour: 11, minute: 0)))
        #expect(airedLabel(hoursAgo(2), now: now, calendar: calendar("Asia/Tokyo")) == .today(Clock(hour: 19, minute: 0)))
    }
}
