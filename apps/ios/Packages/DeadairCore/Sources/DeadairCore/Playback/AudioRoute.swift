/// Where the phone's audio is going, as the app's decisions need it: what kind of output, and what it
/// is called. The app reads it off the audio session's route; nothing here knows AVFoundation, so the
/// two decisions below are tested on the Mac.
public struct AudioOutput: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        /// The phone's own loudspeaker.
        case builtInSpeaker
        /// The earpiece.
        case builtInReceiver
        /// Something plugged into the phone's socket or adapter.
        case headphones
        /// Any Bluetooth audio device: headphones, a speaker, a car's hands-free.
        case bluetooth
        /// An AirPlay speaker or a television.
        case airPlay
        case carAudio
        case usb
        case hdmi
        case other
    }

    public let kind: Kind
    /// The name the system gives the output, which for AirPlay and Bluetooth is the one its owner chose
    /// ("Kitchen", "Living room").
    public let name: String

    public init(kind: Kind, name: String) {
        self.kind = kind
        self.name = name
    }

    /// The phone itself, as opposed to anything the sound has been sent to.
    public var isBuiltIn: Bool { kind == .builtInSpeaker || kind == .builtInReceiver }
}

/// Why the route changed, reduced to the one difference the app acts on.
public enum AudioRouteChange: Sendable, Equatable {
    /// An output went away: headphones pulled out, a Bluetooth device out of range, an AirPlay speaker
    /// switched off.
    case outputGone
    /// Anything else, including the listener choosing an AirPlay speaker or a Bluetooth device in the
    /// route picker.
    case other
}

/// The name for "Playing on" under the controls, or `nil` when the station is coming out of the phone
/// itself (or out of something plugged into it, which the listener can see).
///
/// Only AirPlay and Bluetooth are named: those are the outputs a listener can choose without touching
/// the phone, so they are the ones where it is worth saying where the sound went. The first such
/// output wins, which is the one the system lists first; a nameless one is not worth a line.
public func playingOn(_ outputs: [AudioOutput]) -> String? {
    outputs.first { ($0.kind == .airPlay || $0.kind == .bluetooth) && !$0.name.isEmpty }?.name
}

/// Whether a route change should stop the station.
///
/// Headphones coming out stop it, because `AVPlayer` pauses on its own there and a pause is the one
/// state the app never leaves a mount in. So does an AirPlay speaker or a Bluetooth device going away,
/// for the same reason and because the sound would otherwise move to the phone's loudspeaker in
/// somebody's pocket. Choosing an AirPlay speaker or a Bluetooth device in the picker is a move, not a
/// loss, and must never stop it: the same player carries on to the new output, so it is a transfer and
/// the station still has one listener.
///
/// A loss whose previous route was only the phone itself changes nothing anybody hears and does not
/// stop. A loss with no previous route reported stops, which is what the app did before it looked.
public func routeChangeStops(_ change: AudioRouteChange, previous: [AudioOutput]) -> Bool {
    guard change == .outputGone else { return false }
    return previous.isEmpty || previous.contains { !$0.isBuiltIn }
}
