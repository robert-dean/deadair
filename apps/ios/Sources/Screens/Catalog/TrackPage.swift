import DeadairCore
import DeadairSdk
import SwiftUI

/// One record: what it is, when it aired, and what the providers said about it.
///
/// No copies and no measurement. Those answer "why will this record not play", which is a laptop
/// question with a `docker` answer; the phone carries what a listener or an operator wants to know
/// about the record they just heard.
struct TrackPage: View {
    @Environment(AppModel.self) private var model
    let id: UUID
    @State private var detail: LoadState<TrackDetail> = .loading
    @State private var enrichment: LoadState<EnrichmentUiState> = .loading
    @State private var attempt = 0

    var body: some View {
        DetailBody(state: detail, notFound: .recordNotFound, retry: { attempt += 1 }) { track in
            List {
                DetailHeader(artwork: track.albumImageUrl) {
                    Text(track.title).font(.title3.weight(.semibold))
                    // The credit leads to the canonical artist, and the album to its page.
                    NavigationLink(value: CatalogRoute.artist(track.artistId)) {
                        Text(track.artists).font(.body).foregroundStyle(.tint)
                    }
                    .buttonStyle(.plain)
                    if let album = track.albumName {
                        if let albumId = track.albumId {
                            NavigationLink(value: CatalogRoute.album(albumId)) {
                                Text(album).font(.subheadline).foregroundStyle(.tint).lineLimit(2)
                            }
                            .buttonStyle(.plain)
                        } else {
                            Text(album).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    // The year off the file itself, which the station's own period filter reads; the
                    // providers' release date, when it differs, is in the panel below.
                    let meta = [track.year.map(String.init), track.durationMs.map(clockOf), nonBlank(track.genre)].compactMap { $0 }
                    if !meta.isEmpty {
                        Text(meta.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section(String(localized: "Airings")) {
                    Text(Message.airedTimes(track.playCount).words).foregroundStyle(.secondary)
                    TimelineView(.periodic(from: .now, by: 60)) { context in
                        ForEach(Array(track.plays.sorted { $0.airedAt > $1.airedAt }.enumerated()), id: \.offset) { _, play in
                            LabeledContent(Message.aired(airedLabel(play.airedAt, now: context.date, calendar: .current)).words, value: play.source)
                        }
                    }
                }

                EnrichmentSection(
                    heading: String(localized: "About this record"),
                    state: enrichment,
                    emptyMessage: String(localized: "No provider has been asked about this record yet. The enrichment pass picks up what it has not seen, oldest first.")
                )
            }
        }
        .navigationTitle(String(localized: "Record"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: attempt) {
            if attempt > 0 { detail = .loading }
            let id = id
            async let read = model.read { try await $0.catalog.getTrack(id: id) }
            async let facts = model.read { EnrichmentUiState(try await $0.catalog.getTrackEnrichment(id: id)) }
            if let read = await read { detail = read }
            if let facts = await facts { enrichment = facts }
        }
    }
}
