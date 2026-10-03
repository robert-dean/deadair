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
    /// Asking the station to play a record, and the listener's own requests.
    case request
    /// Everything the station has played.
    case history
    /// Signing in as the station's operator.
    case signIn

    /// A record's page from the id a row carries, or `nil` for a row whose id is not one.
    static func track(_ id: String?) -> PageRoute? {
        id.flatMap(UUID.init(uuidString:)).map(PageRoute.track)
    }

    /// Debug builds open Settings on the page named by `-start_page` (history, scripts, desk, manage,
    /// addRecord, request, or track:, album:, artist: with an id), so a pushed page can be looked at on a
    /// simulator without a tap that might land on something live.
    static var start: [PageRoute] {
        #if DEBUG
        guard let named = UserDefaults.standard.string(forKey: "start_page") else { return [] }
        let parts = named.split(separator: ":", maxSplits: 1).map(String.init)
        let id = parts.count > 1 ? UUID(uuidString: parts[1]) : nil
        switch parts[0] {
        case "history": return [.history]
        case "scripts": return [.scripts(segmentId: nil)]
        case "desk": return [.desk]
        case "manage": return [.manage]
        case "addRecord": return [.addRecord]
        case "request": return [.request]
        case "signIn": return [.signIn]
        case "track": return id.map { [.track($0)] } ?? []
        case "album": return id.map { [.album($0)] } ?? []
        case "artist": return id.map { [.artist($0)] } ?? []
        default: return []
        }
        #else
        return []
        #endif
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
            case .request: RequestScreen()
            case .history: HistoryScreen()
            case .signIn: SignInScreen()
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
            // Android's error page: what went wrong, what to check, and Try again.
            ErrorPlaceholder(what: detailFailure(status, notFound: notFound).words, retry: retry)
        case .loaded(let value):
            content(value)
        }
    }
}

/// The cover, title and credits at the top of every detail page.
struct DetailHeader<Lines: View>: View {
    @Environment(AppModel.self) private var model
    let artwork: String?
    /// The artist page's is smaller and centred against its two lines.
    var side: CGFloat = 112
    var centred = false
    @ViewBuilder let lines: () -> Lines

    var body: some View {
        HStack(alignment: centred ? .center : .top, spacing: 16) {
            ArtworkView(
                url: model.settings.settings.station?.artUrl(artwork).flatMap(URL.init(string:)), loader: model.artwork, cornerRadius: 8,
                placeholderSize: side / 3
            )
            .frame(width: side, height: side)
            VStack(alignment: .leading, spacing: 4, content: lines)
            Spacer(minLength: 0)
        }
    }
}

/// A detail page as Android draws one: a single scrolling column inside the gutter, its parts under
/// headings rather than in grouped cards.
struct DetailColumn<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
        }
    }
}

/// A part of a detail page, named: 24 above, 8 below.
struct SectionHeading: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.callout.weight(.semibold))
            .padding(.top, 24)
            .padding(.bottom, 8)
            .accessibilityAddTraits(.isHeader)
    }
}

/// One row of a list on a detail page: a full-width target, a hairline under all but the last.
struct DetailRow<Content: View>: View {
    var last = false
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            if !last { Divider() }
        }
    }
}

/// Things laid in rows that wrap, Android's `FlowRow`: chips, label-over-value cells, links.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(proposal.width ?? .infinity, subviews)
        let width = rows.map { $0.width }.max() ?? 0
        let height = rows.map { $0.height }.reduce(0, +) + lineSpacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(bounds.width, subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ maxWidth: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = rows[rows.count - 1].indices.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
            if needed > maxWidth, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows[rows.count - 1] = row
        }
        return rows.filter { !$0.indices.isEmpty }
    }
}
