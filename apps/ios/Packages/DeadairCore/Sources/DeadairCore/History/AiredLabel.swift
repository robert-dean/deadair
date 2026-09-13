import Foundation

/// When a record aired, as a listener reads it.
///
/// `airedAt` is a real instant, which makes this the opposite case from the schedule's stamps.
/// Those are readings of the STATION's clock and are shown exactly as written; this one is a point
/// in time, and the listener's own zone is the right one to show it in, which `calendar` carries.
///
/// The unit gets coarser going back, for the same reason a span does: the useful thing about a
/// record played four minutes ago is the clock time, and about one played on Monday is that it was
/// Monday. `apps/android`'s `airedLabel`.
public func airedLabel(_ airedAt: Date, now: Date, calendar: Calendar) -> AiredLabel {
    let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .weekday], from: airedAt)
    let clock = Clock(hour: parts.hour ?? 0, minute: parts.minute ?? 0)
    let daysAgo = calendar.dateComponents([.day], from: calendar.startOfDay(for: airedAt), to: calendar.startOfDay(for: now)).day ?? 0

    switch daysAgo {
    case 0: return .today(clock)
    case 1: return .yesterday(clock)
    // Inside the last week a weekday still identifies the day; past that it stops being one.
    case ..<7:
        if let day = parts.weekday.flatMap(Weekday.init(rawValue:)) { return .weekday(day, clock) }
        return .today(clock)
    default: return .onDate(year: parts.year ?? 0, month: parts.month ?? 0, day: parts.day ?? 0)
    }
}
