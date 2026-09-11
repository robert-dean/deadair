import Foundation


/// The address field, as the setup and settings screens both show it.
///
/// Pure data, so the copy a listener reads for each outcome is decided by a function a test can
/// call. The wording is the thing most likely to be wrong here, and the thing hardest to check by
/// looking at a screenshot.
public struct StationEntryState: Equatable, Sendable {
    public var address: String = ""
    public var checking = false
    /// Set once an address has answered, so the button can name the station rather than "Save".
    public var confirmedName: String?
    public var error: Message?
    /// True when the entered address is plain HTTP, which is ordinary here and worth saying once.
    public var cleartext = false
    /// The origin already kept, when there is one. What lets the settings screen tell an address
    /// that has merely been loaded into the field from one that has been edited: the first has
    /// nothing to check, and offering a Check button for it was two taps to achieve nothing.
    public var stored: String?

    public init(address: String = "", checking: Bool = false, confirmedName: String? = nil, error: Message? = nil, cleartext: Bool = false, stored: String? = nil) {
        self.address = address
        self.checking = checking
        self.confirmedName = confirmedName
        self.error = error
        self.cleartext = cleartext
        self.stored = stored
    }

    /// What sits under the field: the error if there is one, else the confirmation, else the caution.
    public var supportingText: Message? {
        if let error { return error }
        if let confirmedName { return .answeredAs(name: confirmedName) }
        if cleartext { return .notEncrypted }
        return nil
    }

    /// The parsed address, or `nil` while what is typed is not one.
    public var parsed: StationUrl? { try? StationUrl.parse(address).get() }

    /// Whether there is anything to check.
    ///
    /// An address that has already answered has been checked; one that reads as the origin
    /// already kept needs no checking. Everything else, including text that is not an address yet
    /// (which Check answers with the reason), is worth a button.
    public var showsCheck: Bool {
        confirmedName == nil && (stored == nil || parsed?.origin != stored)
    }

    /// Typing again clears both verdicts: what was checked is no longer what is in the field.
    public static func typing(_ address: String, stored: String? = nil) -> StationEntryState {
        let cleartext = address.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("http://")
        return StationEntryState(address: address, cleartext: cleartext, stored: stored)
    }

    /// What is in the field does not parse as an address at all.
    public static func invalid(_ address: String, stored: String? = nil) -> StationEntryState {
        var state = typing(address, stored: stored)
        state.error = .notAnAddress
        return state
    }

    /// Turn a probe's answer into the state the field shows.
    public static func from(_ address: String, check: StationCheck, stored: String? = nil) -> StationEntryState {
        var state = typing(address, stored: stored)
        switch check {
        case .reachable(let name): state.confirmedName = name
        case .incompatible(let missing): state.error = missing.map { .olderApi(missing: $0) } ?? .unknownShape
        case .notAStation(let status): state.error = status.map { .answeredStatus($0) } ?? .notAStation
        case .unreachable: state.error = .couldNotReach
        case .untrusted: state.error = .untrusted
        }
        return state
    }
}
