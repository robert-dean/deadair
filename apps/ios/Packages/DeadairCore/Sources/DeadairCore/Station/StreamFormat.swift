import DeadairSdk

/// A way of listening, as the picker offers it.
///
/// Mapped onto the generated `NowPlayingMountFormat` by two exhaustive switches rather than by
/// restating the wire strings, so a format added to the contract is a compile error here rather
/// than a silent mismatch.
///
/// The order is the order the picker shows, which is the order a listener would rank them: the
/// mount everyone has, then the one that survives a network change, then the better codecs.
public enum StreamFormat: String, CaseIterable, Sendable, Codable {
    /// Always published. MP3 has no switch, so this is the only format guaranteed to exist.
    case mp3
    /// The one to choose on a phone. An Icecast mount is a single long-lived TCP connection, so
    /// moving between wifi and mobile data kills it; HLS is a sequence of requests and survives.
    case hls
    case aac
    case opus
    case flac

    public var wire: NowPlayingMountFormat {
        switch self {
        case .mp3: .mp3
        case .hls: .hls
        case .aac: .aac
        case .opus: .opus
        case .flac: .flac
        }
    }

    /// The format for a wire value. Exhaustive over the generated enum on purpose.
    public init(wire: NowPlayingMountFormat) {
        switch wire {
        case .mp3: self = .mp3
        case .hls: self = .hls
        case .aac: self = .aac
        case .opus: self = .opus
        case .flac: self = .flac
        }
    }

    /// A codec's own name, which is not translated.
    public var label: String {
        switch self {
        case .mp3: "MP3"
        case .hls: "HLS"
        case .aac: "AAC"
        case .opus: "Opus"
        case .flac: "FLAC"
        }
    }
}
