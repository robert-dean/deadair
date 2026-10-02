import DeadairSdk

/// What colour the reading is drawn in. Only `live` means audio is leaving the building.
public enum SilenceTone: Equatable, Sendable {
    case live, standby, off, fault
}

/// What would clear a gate. A shell command is shown as one and offered to copy; anything else is a sentence.
public struct Remedy: Equatable, Sendable {
    public let text: String

    public init(text: String) {
        self.text = text
    }

    public var isCommand: Bool { text.hasPrefix("docker ") }
}

/// Why the station can or cannot be heard, as the phone draws it.
///
/// The console's reading, carried over whole: nothing here works the answer out. The station
/// composes every gate and names its own cause, and this turns that cause into a tone, a label and a
/// title, and sorts the checks into the one that is blocking, the faults it is not blaming, and
/// everything it ruled out, which is the part worth opening the panel for. `apps/android`'s
/// `SilenceReading`.
public struct SilenceReading: Equatable, Sendable {
    public let tone: SilenceTone
    public let label: Message
    public let title: Message
    /// The station's own sentence. Never rewritten.
    public let detail: String
    public let remedy: Remedy?
    /// Faults the station is not blaming, which still want saying.
    public let otherFaults: [SilenceCheck]
    /// Every gate that passed.
    public let ruledOut: [SilenceCheck]

    public var live: Bool { tone == .live }
}

public func readSilence(_ silence: StationSilence) -> SilenceReading {
    let blocking = silence.checks.first { $0.code == silence.cause }
    let tone: SilenceTone =
        if silence.audible { .live }
        else if blocking?.state == .waiting { waitingTones[silence.cause] ?? .standby }
        else { .fault }
    let cause = silence.audible ? SilenceCause.airing : silence.cause
    return SilenceReading(
        tone: tone,
        label: .silenceLabel(cause),
        title: .silenceTitle(cause),
        detail: silence.detail,
        remedy: silence.remedy.map { Remedy(text: $0) },
        otherFaults: silence.checks.filter { $0.state == .fault && $0.code != silence.cause },
        ruledOut: silence.checks.filter { $0.state == .ok }
    )
}

/// The waiting states that are not faults and must not be drawn as one.
///
/// Standby for waiting on a listener, the resting state of an audience-gated station. Off for stood
/// down, because somebody did it on purpose. Partial on purpose: anything else the station calls
/// `waiting` is standby without this file having to hear about it.
private let waitingTones: [SilenceCause: SilenceTone] = [
    .noAudience: .standby,
    .stoodDown: .off,
]
