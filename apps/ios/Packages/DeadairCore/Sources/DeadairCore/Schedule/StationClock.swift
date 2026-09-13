import Foundation

/// Reading the station's clock, which is not this phone's.
///
/// The API sends `YYYY-MM-DD HH:mm:ss` with no offset, deliberately: a block's ends are a READING
/// of the station's own clock rather than a moment in time, and attaching this device's timezone to
/// one would move a show that starts at eight to whatever eight o'clock means here. So every stamp
/// is read on a fixed calendar with no zone of its own (UTC, which has no clock changes), displayed
/// exactly as written, and the only arithmetic done on it is the difference between two readings
/// the station sent together. `apps/android`'s `StationClock.kt`, decision for decision.
///
/// At a clock change the answer is how much CLOCK is left, not how much time: on the night the
/// clocks go back, a block ending at two reads an hour shorter than it will run. That is the right
/// answer for a screen whose whole subject is what the station's clock says.
public struct StationStamp: Equatable, Sendable {
    public let year: Int
    public let month: Int
    public let day: Int
    public let hour: Int
    public let minute: Int
    public let second: Int

    /// The reading as an instant on the zone-less calendar, for subtraction and nothing else.
    var instant: Date? { stationCalendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute, second: second)) }

    var weekday: Weekday? {
        instant.map { stationCalendar.component(.weekday, from: $0) }.flatMap(Weekday.init(rawValue:))
    }

    func sameDay(as other: StationStamp) -> Bool { year == other.year && month == other.month && day == other.day }
}

/// Gregorian, on UTC: a calendar with no daylight saving to move anything under the arithmetic.
private let stationCalendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}()

/// A stamp read as the station wrote it, or `nil` for anything that is not one.
public func readClock(_ stamp: String) -> StationStamp? {
    let halves = stamp.split(separator: " ")
    guard halves.count == 2 else { return nil }
    let date = halves[0].split(separator: "-").compactMap { Int($0) }
    let time = halves[1].split(separator: ":").compactMap { Int($0) }
    guard date.count == 3, time.count == 3 else { return nil }
    let reading = StationStamp(year: date[0], month: date[1], day: date[2], hour: time[0], minute: time[1], second: time[2])
    // A stamp that names a day the calendar does not have (the thirtieth of February) is not one.
    guard let instant = reading.instant, stationCalendar.component(.day, from: instant) == reading.day,
          (0..<24).contains(reading.hour), (0..<60).contains(reading.minute), (0..<60).contains(reading.second)
    else { return nil }
    return reading
}

/// How many minutes apart two readings are. Zero when either is unreadable, which shows as "ending".
public func minutesBetween(_ from: String, _ to: String) -> Int {
    guard let start = readClock(from)?.instant, let end = readClock(to)?.instant else { return 0 }
    return Int((end.timeIntervalSince(start) / 60).rounded(.towardZero))
}

/// A number of minutes as a length somebody would say out loud. Past a day the minutes stop being
/// information, so the unit gets coarser as the number grows.
public func spanOf(_ minutes: Int) -> Span {
    if minutes <= 0 { return .ending }
    if minutes < minutesPerHour { return .minutes(minutes) }
    if minutes < minutesPerDay { return .hours(minutes / minutesPerHour, minutes: minutes % minutesPerHour) }
    let days = Int((Double(minutes) / Double(minutesPerDay)).rounded())
    return days == 1 ? .aDay : .days(days)
}

/// A block's hours, with the weekday when it is not the day the station is having. `nil` for a stamp
/// that cannot be read, which is nothing to show.
public func hoursOf(start: String, end: String, now: String) -> BlockHours? {
    guard let from = readClock(start), let to = readClock(end) else { return nil }
    let today = readClock(now)
    let day = today.map { from.sameDay(as: $0) ? nil : from.weekday } ?? nil
    return BlockHours(from: Clock(hour: from.hour, minute: from.minute), to: Clock(hour: to.hour, minute: to.minute), day: day)
}

private let minutesPerHour = 60
private let minutesPerDay = 24 * 60
