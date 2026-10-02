import DeadairCore
import DeadairSdk
import SwiftUI

/// A page pushed onto whichever tab it was opened from: the catalog's, and what the station said.
///
/// Values rather than views, so a record page can lead to its album and the album to its artist and
/// back is a stack: the detail pages are what made a back stack necessary on Android too.
enum PageRoute: Hashable {
    case track(UUID)
    case album(UUID)
    case artist(UUID)
    /// What the station said, narrowed to one break, or everything when `nil`.
    case scripts(segmentId: String?)
    /// Everything that can take the station off air, and why it is or is not on. The operator's.
    case desk
    /// The station's controls beyond a single row of Up next, in one place.
    case manage
    /// Replan this show, or start a new one.
    case plan(currentBrief: String?, somethingOn: Bool)
    /// The playlists and charts that can be put on air.
    case airSomething
    case playlist(pluginId: String, playlistId: String, name: String)
    case chart(id: String, name: String)
    /// A record from the library, into the running order.
    case addRecord

    /// A record's page from the id a row carries, or `nil` for a row whose id is not one.
    static func track(_ id: String?) -> PageRoute? {
        id.flatMap(UUID.init(uuidString:)).map(PageRoute.track)
    }
}

extension View {
    /// Where a page link leads, for every stack that can show one.
    func pageDestinations() -> some View {
        navigationDestination(for: PageRoute.self) { route in
            switch route {
            case .track(let id): TrackPage(id: id)
            case .album(let id): AlbumPage(id: id)
            case .artist(let id): ArtistPage(id: id)
            case .scripts(let segmentId): ScriptsScreen(segmentId: segmentId)
            case .desk: DeskScreen()
            case .manage: ManageScreen()
            case .plan(let brief, let on): PlanScreen(currentBrief: brief, somethingOn: on)
            case .airSomething: AirSomethingScreen()
            case .playlist(let pluginId, let playlistId, let name): PlaylistScreen(pluginId: pluginId, playlistId: playlistId, name: name)
            case .chart(let id, let name): ChartScreen(chartId: id, name: name)
            case .addRecord: AddRecordScreen()

            }
        }
    }
}

/// One signed-in read for a page, keyed on what it is for.
///
/// Answers `nil` when the page went away before the answer came, so the caller leaves its state alone.
extension AppModel {
    func read<Value: Sendable>(_ body: @escaping @Sendable (Deadair) async throws -> Value) async -> LoadState<Value>? {
        try? await loadState { try await self.session.withSession(body) }
    }
}

/// A detail page's frame: a spinner, the reason it has nothing, or the page.
struct DetailBody<Value: Sendable, Content: View>: View {
    let state: LoadState<Value>
    let notFound: Message
    let retry: () -> Void
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        switch state {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let status):
            VStack(spacing: 12) {
                Text(detailFailure(status, notFound: notFound).words)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                if status != 404 {
                    Button(String(localized: "Try again"), action: retry).buttonStyle(.bordered)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let value):
            content(value)
        }
    }
}

/// The cover, title and credits at the top of every detail page.
struct DetailHeader<Lines: View>: View {
    @Environment(AppModel.self) private var model
    let artwork: String?
    @ViewBuilder let lines: () -> Lines

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            ArtworkView(url: model.settings.settings.station?.artUrl(artwork).flatMap(URL.init(string:)), loader: model.artwork, cornerRadius: 8, placeholderSize: 36)
                .frame(width: 112, height: 112)
            VStack(alignment: .leading, spacing: 4, content: lines)
            Spacer(minLength: 0)
        }
        .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
    }
}
