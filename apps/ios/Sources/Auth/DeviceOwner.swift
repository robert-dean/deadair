import LocalAuthentication

/// The phone's own check that this is its owner: Face ID or Touch ID, falling back to the passcode,
/// which is the way in when a face fails.
@MainActor
enum DeviceOwner {
    /// Whether this phone has any lock of its own to ask.
    static var canBeChecked: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    /// Ask, and answer whether it was the owner. A phone whose passcode has since been taken off has
    /// nothing left to ask and answers yes: its owner would otherwise be shut out of a lock only they
    /// turned on, by somebody who had to know the passcode to remove it. Cancelling answers no, and
    /// leaves things as they were.
    static func check() async -> Bool {
        guard canBeChecked else { return true }
        do {
            return try await LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: String(localized: "Unlock the station's controls"))
        } catch {
            return false
        }
    }
}
