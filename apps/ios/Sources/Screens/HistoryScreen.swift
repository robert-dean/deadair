import DeadairCore
import DeadairSdk
import SwiftUI

/// What the station has played, newest first, for the signed-in account.
///
/// The head of the list is polled while the screen is open and nothing is asked once it closes;
/// scrolling to the last row fetches the page behind it. Everything the list says is decided in
/// `HistoryRepository` and `airedLabel`, where the tests are.
struct HistoryScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let list = model.history.list(signedIn: model.signedIn)
        let station = model.settings.settings.station

        Group {
            switch list {
            case .signedOut:
                SignedOutPlaceholder(what: String(localized: "History"))
            case .loading:
                ProgressView()
            case .unreachable:
                ErrorPlaceholder(retry: { model.history.retry() })
            case .loaded(let entries, let canLoadMore, let loadingMore, let stale):
                if entries.isEmpty {
                    EmptyPlaceholder(what: String(localized: "Nothing has aired yet."))
                } else {
                    List {
                        if stale { StaleBanner() }
                        // Each row keeps its own label current: a TimelineView around the ForEach made the
                        // whole list one row of the List, every record stacked in a single cell.
                        ForEach(entries, id: \.id) { entry in
                            let row = Row(entry: entry, artwork: station?.artUrl(entry.artworkUrl).flatMap(URL.init(string:)))
                                .opacity(stale ? 0.6 : 1)
                            if let route = PageRoute.track(entry.trackId) {
                                NavigationLink(value: route) { row }
                            } else {
                                row
                            }
                        }
                        if canLoadMore {
                            HStack {
                                Spacer()
                                if loadingMore { ProgressView() }
                                Spacer()
                            }
                            // The row coming into view is the ask; `loadMore` does nothing while one is
                            // already running, so appearing twice costs nothing.
                            .onAppear { Task { await model.history.loadMore() } }
                        }
                    }
                    .listStyle(.plain)
                }
            }
        }
        .navigationTitle(String(localized: "Played"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { model.history.retry() }
        // Re-held when the account changes, so a list read under one sign-in is never shown under another.
        .task(id: model.session.stored?.email) {
            model.history.reset()
            await model.history.hold()
        }
    }

    private struct Row: View {
        @Environment(AppModel.self) private var model
        let entry: HistoryEntry
        let artwork: URL?

        var body: some View {
            HStack(spacing: 12) {
                ArtworkView(url: artwork, loader: model.artwork, cornerRadius: 6, placeholderSize: 20)
                    .frame(width: 48, height: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title).lineLimit(1)
                    Text(entry.artists).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                AiredText(date: entry.airedAt)
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        }
    }
}


/// When something aired, as the reader would say it, kept current once a minute by the label itself.
///
/// Its own timeline rather than one around a list: a `TimelineView` wrapping a `ForEach` in a
/// `List` is ONE row of that list, and every record ended up stacked in a single cell.
struct AiredText: View {
    let date: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            Text(Message.aired(airedLabel(date, now: context.date, calendar: .current)).words)
        }
    }
}
