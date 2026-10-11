import Foundation

/// The two files the app writes for the widget and the widget reads: the state, and the cover.
///
/// They live in the App Group's shared container, the only place an app and its extension can both
/// reach. The app is the only writer; the widget only reads, and never asks the station for
/// anything, Android's widget rule for Android's reason. The cover is written here by the app,
/// fetched through `ArtworkLoader` under the app's one User-Agent, rather than fetched by the
/// widget, which would be a second client the station counts.
///
/// Everything in these files is listed in `PRIVACY.md`.
public struct WidgetStore: Sendable {
    /// The App Group both targets name in their entitlements.
    public static let appGroup = "group.com.maroonedsoftware.deadair"
    /// What the widget is registered as, so the app can ask for exactly it to be redrawn.
    public static let kind = "StationWidget"

    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    /// The shared container's store, or `nil` when the build carries no App Group, which is every
    /// build signed without one. The app then writes nothing and the widget says to open the app.
    public static func shared(_ fileManager: FileManager = .default) -> WidgetStore? {
        fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup).map { WidgetStore(directory: $0.appending(path: "Widget", directoryHint: .isDirectory)) }
    }

    var stateFile: URL { directory.appending(path: "state.json") }

    /// Where the cover is, for the widget to read. Whatever is there is the picture of the last
    /// record that had one, which is the wallpaper's rule: a picture one record old beats a blank.
    public var coverFile: URL { directory.appending(path: "cover.jpg") }

    /// The state as it was last written, or `nil` for none or for a file this build cannot read.
    public func read() -> WidgetState? {
        guard let data = try? Data(contentsOf: stateFile) else { return nil }
        return try? JSONDecoder().decode(WidgetState.self, from: data)
    }

    /// Atomically, so the widget never reads half a file.
    public func write(_ state: WidgetState) throws {
        try ensureDirectory()
        try JSONEncoder().encode(state).write(to: stateFile, options: .atomic)
    }

    public func writeCover(_ data: Data) throws {
        try ensureDirectory()
        try data.write(to: coverFile, options: .atomic)
    }

    public func removeCover() {
        try? FileManager.default.removeItem(at: coverFile)
    }

    private func ensureDirectory() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
}
