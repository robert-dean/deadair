/// Whether somebody has proved they are the phone's owner since the app was last away for a while.
///
/// This is a gate on what the app DRAWS, and nothing else. The Keychain item stays
/// `AfterFirstUnlockThisDeviceOnly`, because the player, CarPlay and a lock-screen press all reach it
/// with nobody at the screen, and the station knows nothing of it. What it answers is an unlocked
/// phone in somebody else's hand. `apps/android`'s `OperatorLock`.
///
/// Starts shut, so a new process asks whatever the last one was told. Instants are the continuous
/// clock's, which counts through sleep and which the phone's owner cannot set back.
public struct OperatorLock: Equatable, Sendable {
    /// How long the app may be out of sight before the operator's controls want unlocking again.
    public static let grace: Duration = .seconds(5 * 60)

    /// Whether the controls are open, whatever the setting says.
    public private(set) var isOpen = false
    private var leftAt: ContinuousClock.Instant?

    public init() {}

    /// The phone's owner just proved it.
    public mutating func unlocked() {
        isOpen = true
        leftAt = nil
    }

    /// The app went into the background.
    public mutating func left(at now: ContinuousClock.Instant) {
        if isOpen { leftAt = now }
    }

    /// The app came back. Shuts the lock if it was away for the whole of the grace.
    public mutating func returned(at now: ContinuousClock.Instant) {
        guard let leftAt else { return }
        self.leftAt = nil
        if leftAt.duration(to: now) >= Self.grace { isOpen = false }
    }
}
