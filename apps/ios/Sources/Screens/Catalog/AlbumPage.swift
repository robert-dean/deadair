import DeadairCore
import DeadairSdk
import SwiftUI

/// An album: its art, its artist, its year and how many tracks, the providers' word, and the tracks.
struct AlbumPage: View {
    @Environment(AppModel.self) private var model
    let id: UUID
    @State private var album: LoadState<Album> = .loading
    @State private var tracks: LoadState<ListPage<TrackRow>> = .loading
    @State private var enrichment: LoadState<EnrichmentUiState> = .loading
    @State private var attempt = 0
    @State private var ratings = RatingWrites()

    var body: some View {
        DetailBody(state: album, notFound: .albumNotFound, retry: { attempt += 1 }) { album in
            List {
                DetailHeader(artwork: album.imageUrl) {
                    Text(album.name).font(.title3.weight(.semibold))
                    NavigationLink(value: PageRoute.artist(album.artistId)) {
                        Text(album.artistName).font(.body).foregroundStyle(.tint)
                    }
                    .buttonStyle(.plain)
                    let meta = [album.year.map(String.init), Message.trackCount(album.trackCount).words].compactMap { $0 }
                    Text(meta.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                }

                if model.isOperator {
                    RatingSection(rating: album.rating, label: album.name, busy: ratings.busy) { mark in
                        ratings.rate({ await model.catalogActions.rateAlbum(id, mark) }, then: { attempt += 1 })
                    }
                }

                Section(String(localized: "Tracks")) {
                    switch tracks {
                    case .loading:
                        Text(String(localized: "Loading…")).font(.footnote).foregroundStyle(.secondary)
                    case .failed:
                        Text(Message.cantReachStation.words).font(.footnote).foregroundStyle(.red)
                    case .loaded(let page) where page.items.isEmpty:
                        Text(String(localized: "No tracks from this album are in the catalog.")).font(.footnote).foregroundStyle(.secondary)
                    case .loaded(let page):
                        ForEach(page.items, id: \.id) { track in
                            NavigationLink(value: PageRoute.track(track.id)) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(track.title).lineLimit(1)
                                    let line = [nonBlank(track.artists), track.durationMs.map(clockOf)].compactMap { $0 }.joined(separator: " · ")
                                    if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                                }
                            }
                        }
                        if page.notShown > 0 {
                            Text(Message.moreNotShown(page.notShown).words).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }

                EnrichmentSection(
                    heading: String(localized: "About this album"),
                    state: enrichment,
                    emptyMessage: String(localized: "No provider has been asked about this album yet. The enrichment pass picks up what it has not seen, oldest first.")
                )
            }
        }
        .navigationTitle(String(localized: "Album"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: attempt) {
            // A retry after a failure shows the spinner; a re-read after a rating keeps the page up.
            if attempt > 0, album.value == nil { album = .loading }
            let id = id
            async let read = model.read { try await $0.catalog.getAlbum(id: id) }
            async let list = model.read { deadair in
                let page = try await deadair.catalog.listAlbumTracks(id: id, query: TrackQueryInput(page: 0, pageSize: ListPage<TrackRow>.largest, sort: .asc, sortBy: .title))
                return ListPage(items: page.data, total: page.meta.total)
            }
            async let facts = model.read { EnrichmentUiState(try await $0.catalog.getAlbumEnrichment(id: id)) }
            if let read = await read { album = read }
            if let list = await list { tracks = list }
            if let facts = await facts { enrichment = facts }
        }
    }
}
