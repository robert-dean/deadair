import DeadairCore
import DeadairSdk
import Foundation
import Observation
import WidgetKit

/// What keeps the widget's file current, and the only thing that writes it.
///
/// **It follows what the app already knows and asks the station nothing.** It reads
/// `AppModel.heardState`, which carries whatever the screen or the player is already polling for and
/// is still otherwise; it holds no lease of its own. A phone with nothing playing and the app
/// closed therefore writes nothing, reloads nothing and asks the station nothing, which is
/// `apps/android`'s `WidgetFeed` rule for the same reason. While this phone plays, the reading is the
/// one `NowPlayingGate` has released, so the widget changes record when the lock screen does.
///
/// **A write only when something drawn moved** (`worthDrawing`), because every write is also a
/// timeline reload. The cover is fetched through `ArtworkLoader`, shrunk, and written beside the
/// state; the widget reads the file and never fetches anything.
@MainActor
final class WidgetFeed {
    /// Everything the file is made from, read inside one observation so any of it moving re-runs it.
    struct Inputs {
        let heard: NowPlayingState
        let requested: Bool
        let playing: Bool
        let station: StationUrl?
        let stationName: String?
    }

    private let store: WidgetStore
    private let artwork: ArtworkLoader
    private let read: @MainActor () -> Inputs
    /// Told about every state that was written, for the Live Activity, which follows the same reading.
    var onWritten: (@MainActor (WidgetState) -> Void)?

    /// What is on disk, hydrated before the first reading so an unchanged one writes nothing.
    private(set) var last: WidgetState
    private var origin: String?
    private var started = false
    /// The picture `cover.jpg` holds, so a reading naming the same one does not fetch it again.
    private var coverUrl: String?
    private var loading: Task<Void, Never>?

    init(store: WidgetStore, artwork: ArtworkLoader, read: @escaping @MainActor () -> Inputs) {
        self.store = store
        self.artwork = artwork
        self.read = read
        last = store.read() ?? WidgetState()
    }

    func start() {
        guard !started else { return }
        started = true
        origin = read().station?.origin
        follow()
    }

    private func follow() {
        let inputs = withObservationTracking {
            read()
        } onChange: { [weak self] in
            Task { @MainActor in self?.follow() }
        }
        moved(inputs)
    }

    private func moved(_ inputs: Inputs) {
        var snapshot = last.snapshot
        let origin = inputs.station?.origin
        if origin != self.origin {
            // The old station's record is not this one's. Cleared rather than left to be
            // overwritten, because with nothing playing nothing may ever overwrite it.
            self.origin = origin
            snapshot = WidgetSnapshot(stationName: inputs.stationName)
        }
        snapshot = advance(snapshot, heard: inputs.heard, station: inputs.station, stationName: inputs.stationName, now: Date())
        if snapshot.stationName == nil { snapshot.stationName = inputs.stationName }
        let next = WidgetState(
            snapshot: snapshot,
            playback: widgetPlayback(requested: inputs.requested, playing: inputs.playing),
            hasStation: inputs.station != nil
        )
        guard worthDrawing(last, next) else { return }
        try? store.write(next)
        last = next
        cover(next.snapshot)
        reload()
        onWritten?(next)
    }

    /// Fetch the cover for a snapshot, if it names one the file does not already hold.
    ///
    /// A cover that will not load leaves what is there, the wallpaper's rule and Android's: a picture
    /// one record old is better than a blank, and the next record is minutes away. Off air clears it,
    /// because then there is nothing it could be the cover OF.
    private func cover(_ snapshot: WidgetSnapshot) {
        guard let url = snapshot.onAir ? snapshot.artworkUrl : nil, let address = URL(string: url) else {
            loading?.cancel()
            coverUrl = nil
            store.removeCover()
            return
        }
        guard url != coverUrl else { return }
        loading?.cancel()
        loading = Task { [weak self, artwork, store] in
            guard let image = await artwork.image(for: address), let data = Platform.widgetCover(image), !Task.isCancelled else { return }
            try? store.writeCover(data)
            self?.coverUrl = url
            self?.reload()
        }
    }

    private func reload() {
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetStore.kind)
    }
}
