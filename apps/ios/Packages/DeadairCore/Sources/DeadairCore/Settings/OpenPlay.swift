/// Whether opening the app should start the station: yes exactly once per process, and only with a
/// station kept and the setting on.
///
/// Once, because the view that asks can appear more than once in a process (a scene coming back, a
/// root rebuilt) and each of those is a return rather than an open. A launch that begins in Setup
/// asks once with no station and is answered no, so finishing Setup never starts the station by
/// itself. `apps/android`'s `playOnOpen`, where the once is held by the activity instead.
public struct OpenPlay: Sendable {
    private var asked = false

    public init() {}

    public mutating func shouldPlay(_ settings: ListenerSettings) -> Bool {
        guard !asked else { return false }
        asked = true
        return settings.playOnOpen && settings.station != nil
    }
}
