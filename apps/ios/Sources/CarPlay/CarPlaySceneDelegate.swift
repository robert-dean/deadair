// CarPlay is iOS-only, and everything else outside `Playback/Platform.swift` compiles for the Mac as it
// stands, which is what lets the app be type-checked there. This file keeps that true by being absent
// where CarPlay is.
#if canImport(CarPlay)
import CarPlay
import DeadairCore
import UIKit

/// The station in the car: one row, the station, and the system's own Now Playing screen after it.
///
/// **It is harmless without the entitlement.** CarPlay only ever connects a scene to an app Apple has
/// granted `com.apple.developer.carplay-audio` and whose build carries it. Without that nothing here
/// is instantiated and the app is exactly what it was, which is why it can ship in a build that does
/// not have the entitlement (see `apps/ios/CLAUDE.md`, "CarPlay").
///
/// **The delegate holds nothing.** The scene can be connected to a process the phone's UI never
/// started (the car wakes the app), so everything it reads comes from `AppModel.shared`, the one
/// graph, and the player it presses is the one the Play button presses.
@MainActor
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var station: CarStationScreen?

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        station = CarStationScreen(interface: interfaceController, model: AppModel.shared)
    }

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        station?.end()
        station = nil
    }
}

/// The list template with its one row, kept in step with the station.
///
/// **The row holds exactly one item and must never hold a second**, for the reason `CarStationItem`
/// gives and Android Auto's library gives: a second row is a second thing to press, and a head unit
/// reads a list as something with a next. What the row SAYS is `carStationItem`'s decision; this type
/// draws it and redraws only when it changed.
///
/// Playing hands over to `CPNowPlayingTemplate.shared`, which draws the lock screen's own
/// `MPNowPlayingInfoCenter` information and sends its buttons to the same remote commands
/// `SystemNowPlaying` already answers, so nothing is published for the car a second time.
@MainActor
private final class CarStationScreen {
    private let interface: CPInterfaceController
    private let model: AppModel
    private let row: CPListItem
    private var drawn: CarStationItem?
    private var ended = false

    init(interface: CPInterfaceController, model: AppModel) {
        self.interface = interface
        self.model = model
        row = CPListItem(text: nil, detailText: nil, image: Self.placeholder)
        // CarPlay calls this on the main thread, but a closure written inside a main-actor type is
        // checked for that at run time, so it is `@Sendable` and asserts the isolation itself.
        row.handler = { @Sendable [weak self] _, done in
            MainActor.assumeIsolated { self?.selected() }
            done()
        }
        refresh()
        let template = CPListTemplate(title: drawn?.name, sections: [CPListSection(items: [row])])
        interface.setRootTemplate(template, animated: false, completion: nil)
    }

    func end() {
        ended = true
    }

    /// The row was pressed: put the station on and show the system's Now Playing screen.
    private func selected() {
        guard drawn?.canPlay == true else { return }
        model.listening.play()
        interface.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
    }

    /// Redraw the row if what it says moved, and look again whenever any of it might.
    private func refresh() {
        guard !ended else { return }
        withObservationTracking {
            draw(from: model)
        } onChange: { [weak self] in
            Task { @MainActor in self?.refresh() }
        }
    }

    private func draw(from model: AppModel) {
        let kept = model.settings.settings
        let item = carStationItem(station: kept.station, name: kept.stationName, reading: model.listening.shown, playing: model.listening.wantsToPlay)
        guard item != drawn else { return }
        let cover = item.artworkUrl != drawn?.artworkUrl
        drawn = item
        row.setText(item.name)
        row.setDetailText(item.lines.map(\.words).joined(separator: " · "))
        row.isPlaying = item.playing
        if cover { loadCover(item.artworkUrl) }
    }

    /// The cover through the app's one loader, for the reason `ArtworkLoader` gives, and only if the
    /// row has not moved on to another record while it was coming.
    private func loadCover(_ url: String?) {
        guard let url, let address = URL(string: url) else {
            row.setImage(Self.placeholder)
            return
        }
        Task {
            guard let image = await model.artwork.image(for: address), drawn?.artworkUrl == url else { return }
            row.setImage(image)
        }
    }

    private static var placeholder: UIImage {
        UIImage(systemName: "radio") ?? UIImage()
    }
}
#endif
