import DeadairSdk
import Foundation

/// The request page's rules, which are the station's rules restated. `apps/android`'s `RequestUiState`.
public enum RequestRules {
    /// How many matches the request search asks for: the station's ceiling. A listener narrows by
    /// typing rather than by paging, so there is no second page to fetch.
    public static let searchLimit = 25
    /// The station's own caps on what goes with a request (`ListenerRequestCreate`), so a field
    /// cannot hold a 400.
    public static let nameMax = 60
    public static let dedicateMax = 60
    public static let messageMax = 200
    /// How often My requests is asked again while the page is showing. The console's cadence for the
    /// same list.
    public static let pollInterval: Duration = .seconds(15)

    /// Whether the station may still play it. The open states, as the console counts them.
    public static func isOpen(_ status: RequestStatus) -> Bool {
        status == .waiting || status == .pending || status == .queued
    }

    /// What the station did with a request it has just been sent.
    ///
    /// A refusal is not an error here: the station answers 201 with the request it wrote, `declined`
    /// and a reason in its own words, so the status decides the sentence, never the HTTP code.
    public static func outcome(_ request: ListenerRequest) -> Message {
        switch request.status {
        case .waiting: .requestWaiting(request.title)
        case .pending, .queued, .aired: .requestOnItsWay(request.title)
        case .declined, .expired: .requestRefused(request.reason)
        }
    }
}

/// One match from the request search, as the list draws it.
///
/// Every row is requestable: the station's search leaves out anything it could not play or that
/// somebody has disliked. A request can still be refused, by the station's rules rather than the
/// record's.
public struct RequestRow: Equatable, Sendable, Identifiable {
    public let id: UUID
    public let title: String
    public let artist: String
    public let detail: String?

    /// `nil` for a record only a provider carries, which this page does not offer yet.
    public init?(_ track: RequestableTrack) {
        guard let trackId = track.trackId else { return nil }
        id = trackId
        title = track.title
        artist = track.artist
        let parts = [track.album, track.year.map(String.init)].compactMap { $0 }
        detail = parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// What goes with a request, as typed.
///
/// A blank field is OMITTED rather than sent empty: the station refuses an empty string (`min=1`),
/// and an omitted name is "a listener", which is the right answer for somebody who left it blank.
public struct RequestForm: Equatable, Sendable {
    public var name: String
    public var dedicateTo: String
    public var message: String

    public init(name: String = "", dedicateTo: String = "", message: String = "") {
        self.name = name
        self.dedicateTo = dedicateTo
        self.message = message
    }

    public func body(trackId: UUID) -> ListenerRequestCreate {
        ListenerRequestCreate(
            trackId: trackId,
            name: Self.sent(name, max: RequestRules.nameMax),
            dedicateTo: Self.sent(dedicateTo, max: RequestRules.dedicateMax),
            message: Self.sent(message, max: RequestRules.messageMax)
        )
    }

    private static func sent(_ text: String, max: Int) -> String? {
        let trimmed = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(max))
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// One of the listener's own requests, with the line under it.
///
/// The note is the most useful thing to know next: when it aired, why it never will, or who it is
/// for while it is still on its way.
public struct MyRequestRow: Equatable, Sendable, Identifiable {
    public let id: UUID
    public let title: String
    public let artist: String
    public let status: RequestStatus
    public let note: Message?

    public init(_ request: ListenerRequest, now: Date, calendar: Calendar) {
        id = request.id
        title = request.title
        artist = request.artist
        status = request.status
        switch request.status {
        case .aired: note = request.airedAt.map { .aired(airedLabel($0, now: now, calendar: calendar)) }
        case .declined, .expired: note = request.reason.map(Message.text)
        default: note = request.dedicateTo.map(Message.requestFor)
        }
    }
}
