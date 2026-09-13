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
                placeholder(String(localized: "The station keeps this for signed-in listeners. Listening itself needs no account."))
            case .loading:
                ProgressView()
            case .unreachable:
                placeholder(String(localized: "Can't reach the station. Pull down to try again."))
            case .loaded(let entries, let canLoadMore, let loadingMore, let stale):
                if entries.isEmpty {
                    placeholder(String(localized: "Nothing has aired yet."))
                } else {
                    List {
                        if stale { StaleBanner() }
                        TimelineView(.periodic(from: .now, by: 60)) { context in
                            ForEach(entries, id: \.id) { entry in
                                Row(entry: entry, artwork: station?.artUrl(entry.artworkUrl).flatMap(URL.init(string:)), now: context.date)
                                    .opacity(stale ? 0.6 : 1)
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
        .miniPlayer()
    }

    private func placeholder(_ words: String) -> some View {
        Text(words)
            .font(.callout)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private struct Row: View {
        @Environment(AppModel.self) private var model
        let entry: HistoryEntry
        let artwork: URL?
        let now: Date

        var body: some View {
            HStack(spacing: 12) {
                ArtworkView(url: artwork, loader: model.artwork, cornerRadius: 6, placeholderSize: 20)
                    .frame(width: 48, height: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title).lineLimit(1)
                    Text(entry.artists).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                Text(Message.aired(airedLabel(entry.airedAt, now: now, calendar: .current)).words)
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// Said above a list when what it shows came from a reading that has since gone stale.
struct StaleBanner: View {
    var body: some View {
        Label(String(localized: "Can't reach the station. Showing what it said last."), systemImage: "wifi.exclamationmark")
            .font(.footnote)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(.yellow.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
            .listRowSeparator(.hidden)
    }
}
