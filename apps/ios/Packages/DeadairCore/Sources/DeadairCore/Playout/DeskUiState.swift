import DeadairSdk
import Foundation

/// Whether, and how, the schedule has been told to leave this broadcast alone.
public enum HoldUi: Equatable, Sendable {
    /// A person is driving and the schedule will take it back at the next block. Offer to keep it on.
    case offered
    case heldUntilReleased
    case heldUntil(Clock)
}

extension TransportUiState {
    /// Who chose what is on, in the words the answer is in. Nothing while the station is off.
    public var driving: Message? {
        switch air?.airSource {
        case .schedule: .schedulePutThisOn
        case .sustaining: .betweenBlocks
        case .operator: .youPutThisOn
        case .off, nil: nil
        }
    }

    /// Offered only while a person is driving, because holding the schedule off a broadcast the
    /// schedule itself put on is not a thing to want. `holdUntil` absent WHILE held is the hold that
    /// never lapses, which is a real state and not a missing value.
    public func hold(calendar: Calendar = .current) -> HoldUi? {
        guard let air, air.airSource == .operator else { return nil }
        guard air.held else { return .offered }
        guard let until = air.holdUntil else { return .heldUntilReleased }
        guard let date = parseInstant(until) else { return .heldUntilReleased }
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return .heldUntil(Clock(hour: parts.hour ?? 0, minute: parts.minute ?? 0))
    }
}

/// An ISO-8601 instant, with or without fractional seconds.
func parseInstant(_ text: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: text) ?? ISO8601DateFormatter().date(from: text)
}

/// The record on air, as the desk names it.
public struct DeskRecord: Equatable, Sendable {
    public let title: String
    public let artworkUrl: String?
    public let line: Message
}

/// What the desk says above its controls: on or off air, and in what words.
///
/// On air is the station's own verdict (`silence.audible`, through the reading's tone), not whether
/// the stream is up or the air is active: either can be true of a station nobody can hear, and the
/// heading is the answer to "can anyone hear this". Off air, the line under it is the station's title
/// for why, the same words the panel below opens on, so the two cannot disagree. `apps/android`'s
/// `DeskUiState`.
public struct DeskUiState: Equatable, Sendable {
    public let transport: TransportUiState
    public let silence: SilenceReading

    public init(transport: TransportUiState) {
        self.transport = transport
        silence = readSilence(transport.status.silence)
    }

    public var onAir: Bool { silence.live }

    public var heading: Message { onAir ? .deskOnAir : .deskOffAir }

    public var line: Message {
        onAir ? .goingOut(name: nonBlank(transport.air?.name), listeners: transport.status.listeners) : silence.title
    }

    /// What is on, with what is left of it when the station says. Nothing between records.
    public var record: DeskRecord? {
        guard let now = transport.status.nowPlaying else { return nil }
        let artists = now.item.artists.joined(separator: ", ")
        return DeskRecord(
            title: now.item.title,
            artworkUrl: now.item.artworkUrl,
            line: now.remainingMs.map { .timeLeft(artists: artists, left: clockOf($0)) } ?? .text(artists)
        )
    }
}

/// Take off air, held one press away from firing.
///
/// Take off air is the one control on the desk that silences the station, and a confirm dialog is the
/// ordinary answer and the wrong one on a phone used from bed: a modal over a button is a second
/// target to find rather than a moment to think. So the button arms itself and says so by changing
/// its name, and disarms on its own: a stop left armed in a pocket is a stop that fires on the next
/// stray press. The console's five seconds, and never persisted. `apps/android`'s `ArmedStop`.
public struct ArmedStop: Equatable, Sendable {
    /// How long an armed stop stays armed before it forgets. The console's own figure.
    public static let window: Duration = .seconds(5)

    public private(set) var armedAt: ContinuousClock.Instant?

    public init() {}

    public func isArmed(at now: ContinuousClock.Instant) -> Bool {
        guard let armedAt else { return false }
        return now - armedAt < Self.window
    }

    /// Arms on the first press, and answers `true` on a second press inside the window, which fires.
    public mutating func press(at now: ContinuousClock.Instant) -> Bool {
        if isArmed(at: now) {
            armedAt = nil
            return true
        }
        armedAt = now
        return false
    }

    public mutating func disarm() {
        armedAt = nil
    }
}
