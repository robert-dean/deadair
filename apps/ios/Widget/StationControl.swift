/// The widget's half of `StationControl`, which exists so `Shared/StationIntents.swift` compiles here.
///
/// Nothing calls it. The intents a widget button names are `AudioPlaybackIntent`s, which iOS performs
/// in the APP's process, where the app's own `StationControl` acts on `AppModel.shared`. The extension
/// has no player and must never grow one: it would be a second listener the station counts.
@MainActor
enum StationControl {
    static func play() throws {}
    static func stop() {}
}
