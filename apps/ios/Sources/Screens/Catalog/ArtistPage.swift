import DeadairCore
import DeadairSdk
import SwiftUI

/// An artist: their albums, newest first, and what the providers say about them.
struct ArtistPage: View {
    @Environment(AppModel.self) private var model
    let id: UUID
    @State private var artist: LoadState<Artist> = .loading
    @State private var albums: LoadState<ListPage<Album>> = .loading
    @State private var enrichment: LoadState<EnrichmentUiState> = .loading
    @State private var attempt = 0
    @State private var ratings = RatingWrites()

    var body: some View {
        DetailBody(state: artist, notFound: .artistNotFound, retry: { attempt += 1 }) { artist in
            DetailColumn {
                DetailHeader(artwork: artist.imageUrl, side: 96, centred: true) {
                    Text(artist.name).font(.title2)
                    Text("\(Message.albumCount(artist.albumCount).words) · \(Message.trackCount(artist.trackCount).words)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if model.isOperator {
                    RatingSection(rating: artist.rating, label: artist.name, busy: ratings.busy) { mark in
                        ratings.rate({ await model.catalogActions.rateArtist(id, mark) }, then: { attempt += 1 })
                    }
                    .padding(.top, 16)
                }

                // Who they are before what they made, as on Android.
                EnrichmentSection(
                    heading: String(localized: "About this artist"),
                    state: enrichment,
                    emptyMessage: String(localized: "No provider has been asked about this artist yet. The enrichment pass picks up what it has not seen, oldest first.")
                )

                SectionHeading(String(localized: "Albums"))
                switch albums {
                case .loading:
                    Text(String(localized: "Loading…")).font(.caption).foregroundStyle(.secondary)
                case .failed:
                    Text(Message.cantReachStation.words).font(.caption).foregroundStyle(.red)
                case .loaded(let page) where page.items.isEmpty:
                    Text(String(localized: "Nothing by this artist has been ingested as an album. Their tracks may still be in the catalog, filed without a release."))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                case .loaded(let page):
                    ForEach(Array(page.items.enumerated()), id: \.element.id) { index, album in
                        NavigationLink(value: PageRoute.album(album.id)) {
                            DetailRow(last: index == page.items.count - 1) {
                                HStack(spacing: 16) {
                                    ArtworkView(
                                        url: model.settings.settings.station?.artUrl(album.imageUrl).flatMap(URL.init(string:)), loader: model.artwork,
                                        cornerRadius: 8, placeholderSize: 16
                                    )
                                    .frame(width: 48, height: 48)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(album.name).lineLimit(1)
                                        let meta = [album.year.map(String.init), Message.trackCount(album.trackCount).words].compactMap { $0 }
                                        Text(meta.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    if page.notShown > 0 {
                        Text(Message.moreNotShown(page.notShown).words).font(.caption).foregroundStyle(.secondary).padding(.top, 8)
                    }
                }
            }
        }
        .navigationTitle(String(localized: "Artist"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: attempt) {
            // A retry after a failure shows the spinner; a re-read after a rating keeps the page up.
            if attempt > 0, artist.value == nil { artist = .loading }
            let id = id
            async let read = model.read { try await $0.catalog.getArtist(id: id) }
            async let list = model.read { deadair in
                let page = try await deadair.catalog.listArtistAlbums(id: id, query: CatalogQueryInput(page: 0, pageSize: ListPage<Album>.largest, sort: .desc, sortBy: .year))
                return ListPage(items: page.data, total: page.meta.total)
            }
            async let facts = model.read { EnrichmentUiState(try await $0.catalog.getArtistEnrichment(id: id)) }
            if let read = await read { artist = read }
            if let list = await list { albums = list }
            if let facts = await facts { enrichment = facts }
        }
    }
}
