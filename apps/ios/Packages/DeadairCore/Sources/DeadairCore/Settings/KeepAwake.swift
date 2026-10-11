/// When Now playing keeps the screen on. `apps/android`'s `KeepAwake`, value for value.
///
/// Never by default: a screen that will not sleep is a battery spent on a picture, and somebody who
/// wants the cover on the kitchen counter all evening can say so.
public enum KeepAwake: String, CaseIterable, Sendable {
    /// The screen sleeps on the phone's own timer, as in any other app.
    case never
    /// On while the phone is on power, which is the counter or the dashboard and costs nothing.
    case whileCharging = "while_charging"
    /// On whatever the battery says.
    case always

    /// Whether the screen is held on right now.
    ///
    /// All of three things: the setting allows it (on power, for `whileCharging`), this phone is
    /// playing, and Now playing is in front. Playing on another device is not enough, because then
    /// the picture is a remote control rather than the radio. `apps/android`'s `keepAwake`.
    public func holdsScreen(charging: Bool, playing: Bool, inFront: Bool) -> Bool {
        let allowed = switch self {
        case .never: false
        case .whileCharging: charging
        case .always: true
        }
        return allowed && playing && inFront
    }
}
