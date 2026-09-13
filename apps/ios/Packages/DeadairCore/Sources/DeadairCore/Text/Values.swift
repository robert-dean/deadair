/// A length of time as somebody would say it.
///
/// The unit gets coarser as the number gets bigger, which is the point: a block that runs once a
/// week is genuinely six days off, and "161 h" is a true answer nobody can read. A value rather
/// than words, so the words can be the language's. `apps/android`'s `Span`, case for case.
public enum Span: Equatable, Sendable {
    case ending
    case minutes(Int)
    case hours(Int, minutes: Int)
    case aDay
    case days(Int)
}

/// A time of day, before it is written in the twelve- or twenty-four-hour form the phone prefers.
public struct Clock: Equatable, Sendable {
    public let hour: Int
    public let minute: Int

    public init(hour: Int, minute: Int) {
        self.hour = hour
        self.minute = minute
    }
}

/// A day of the week, numbered as `Calendar` numbers them: 1 is Sunday.
public enum Weekday: Int, Equatable, Sendable {
    case sunday = 1, monday, tuesday, wednesday, thursday, friday, saturday
}

/// A block's hours, with the weekday when it is not the station's own today.
public struct BlockHours: Equatable, Sendable {
    public let from: Clock
    public let to: Clock
    public let day: Weekday?

    public init(from: Clock, to: Clock, day: Weekday?) {
        self.from = from
        self.to = to
        self.day = day
    }
}

/// When a record aired, in the form that identifies it best from where the reader is standing.
public enum AiredLabel: Equatable, Sendable {
    case today(Clock)
    case yesterday(Clock)
    case weekday(Weekday, Clock)
    case onDate(year: Int, month: Int, day: Int)
}
