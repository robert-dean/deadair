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
                        // Each row keeps its own label current: a TimelineView around the ForEach made the
                        // whole list one row of the List, every record stacked in a single cell.
                        ForEach(entries, id: \.id) { entry in
                            // Only the picture fades while stale: the words are the point, and stay readable.
                            let row = Row(entry: entry, artwork: station?.artUrl(entry.artworkUrl).flatMap(URL.init(string:)), stale: stale)
                            // The link behind the row rather than around it, so the row carries no chevron.
                            row.background {
                                if let route = PageRoute.track(entry.trackId) {
                                    NavigationLink(value: route) { EmptyView() }.opacity(0)
                                }
                            }
                        }
                        // Asked for by name, as on Android, rather than fetched as the foot comes into view.
                        if canLoadMore {
                            EarlierRow(loading: loadingMore) { Task { await model.history.loadMore() } }
                        }
                    }
                    .listStyle(.plain)
                    .staleBanner(stale)
                }
            }
        }
        .navigationTitle(String(localized: "History"))
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
        let stale: Bool

        var body: some View {
            HStack(spacing: 16) {
                ArtworkView(url: artwork, loader: model.artwork, cornerRadius: 4, placeholderSize: 22, dimmed: stale)
                    .frame(width: 48, height: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title).lineLimit(1)
                    Text(entry.artists).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                AiredText(date: entry.airedAt)
                    .font(.caption.weight(.medium).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
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

/// The foot of a list with more behind it: "Earlier", across the width, or a spinner while it loads.
struct EarlierRow: View {
    let loading: Bool
    let load: () -> Void

    var body: some View {
        Group {
            if loading {
                ProgressView()
            } else {
                Button(String(localized: "Earlier"), action: load)
                    .buttonStyle(.borderless)
                    .font(.subheadline.weight(.medium))
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .listRowSeparator(.hidden)
    }
}
