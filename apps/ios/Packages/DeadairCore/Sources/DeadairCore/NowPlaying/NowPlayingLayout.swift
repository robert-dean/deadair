/// How Now playing arranges itself on the room it is given.
///
/// Decided from the size the page is laid out in (inside the safe area), so the same rule covers an
/// iPhone turned on its side, an iPad either way up, and an iPad sharing its screen with another app.
public enum NowPlayingLayout: Equatable, Sendable {
    /// Upright on a phone: the cover runs the width, with the words and the controls under it.
    case fullBleed
    /// On its side, or wide enough to be an iPad: the cover beside the words.
    case sideBySide

    /// The width from which the cover goes beside the words even upright. An iPad's narrowest
    /// portrait is wider than this; an iPhone's widest is not.
    public static let wideEnough: Double = 600

    public init(width: Double, height: Double) {
        self = width > height || width >= Self.wideEnough ? .sideBySide : .fullBleed
    }

    /// Whether the page may rest (the words and the controls faded, the cover alone in the middle).
    ///
    /// Upright only. Beside the words there is no middle for the cover to move to, and the words and
    /// the controls never fade there, so a resting page sideways was one that swallowed the first
    /// touch while still showing every control under it, with nothing to say why the button did
    /// nothing. The tabs still slide away sideways, where the room they give back matters most.
    public func rests(canRest: Bool) -> Bool {
        self == .fullBleed && canRest
    }
}
