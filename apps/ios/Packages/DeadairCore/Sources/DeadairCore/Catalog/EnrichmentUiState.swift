import DeadairSdk
import Foundation

/// The union of the three enrichment payloads: an artist has no tempo, an album has no ISRC, and
/// every field on all three is optional anyway. One shape rather than three, so one panel serves
/// every page and cannot drift between them.
public struct EnrichmentFacts: Equatable, Sendable {
    public var year: Int?
    public var releaseDate: String?
    public var label: String?
    public var bpm: Double?
    public var musicalKey: String?
    public var isrc: String?
    public var biography: String?
    public var genres: [String] = []
    public var moods: [String] = []
    public var facts: [String] = []
    public var links: [EnrichmentLink] = []

    public init() {}

    public init(_ data: TrackEnrichmentData) {
        year = data.year
        releaseDate = data.releaseDate
        label = data.label
        bpm = data.bpm
        musicalKey = data.musicalKey
        isrc = data.isrc
        biography = data.biography
        genres = data.genres ?? []
        moods = data.moods ?? []
        facts = data.facts ?? []
        links = data.links ?? []
    }

    public init(_ data: AlbumEnrichmentData) {
        year = data.year
        releaseDate = data.releaseDate
        label = data.label
        genres = data.genres ?? []
        facts = data.facts ?? []
        links = data.links ?? []
    }

    public init(_ data: ArtistEnrichmentData) {
        biography = data.biography
        genres = data.genres ?? []
        facts = data.facts ?? []
        links = data.links ?? []
    }
}

/// Whether a source said something, said nothing, or could not be asked.
public enum SourceState: Equatable, Sendable {
    case found
    case nothingFound
    case couldNotAsk
    case couldNotReask
}

/// One provider's row, without the payload: who answered, when, and whether they had anything.
public struct Provenance: Equatable, Sendable {
    public let provider: String
    public let fetchedAt: Date
    public let stale: Bool
    public let found: Bool
    public let failed: Bool

    public init(provider: String, fetchedAt: Date, stale: Bool, found: Bool, failed: Bool) {
        self.provider = provider
        self.fetchedAt = fetchedAt
        self.stale = stale
        self.found = found
        self.failed = failed
    }

    public init(_ source: TrackEnrichmentSource) {
        self.init(provider: source.provider, fetchedAt: source.fetchedAt, stale: source.stale, found: source.found, failed: source.failed)
    }

    public init(_ source: AlbumEnrichmentSource) {
        self.init(provider: source.provider, fetchedAt: source.fetchedAt, stale: source.stale, found: source.found, failed: source.failed)
    }

    public init(_ source: ArtistEnrichmentSource) {
        self.init(provider: source.provider, fetchedAt: source.fetchedAt, stale: source.stale, found: source.found, failed: source.failed)
    }

    /// Four states rather than two. A source that answered with nothing and one that could not be
    /// reached are opposite facts: the first is settled and the second is the walk still owing an
    /// answer. A source can be both found and failed: what it said in May is still the best answer
    /// there is, and it could not be re-asked today.
    public var state: SourceState {
        switch (failed, found) {
        case (true, true): .couldNotReask
        case (true, false): .couldNotAsk
        case (false, true): .found
        case (false, false): .nothingFound
        }
    }
}

/// The scalar fields, in the order they are worth reading.
public enum EnrichmentField: Equatable, Sendable {
    case released, label, bpm, key, isrc
}

/// What the providers said about one artist, record or recording, as the panel lays it out.
///
/// The provenance is not decoration: everything above it is a claim by some upstream, and somebody
/// looking at a wrong genre needs to know which source to go and correct and how old the answer is.
/// `apps/android`'s `EnrichmentUiState`.
public struct EnrichmentUiState: Equatable, Sendable {
    public let facts: EnrichmentFacts
    public let sources: [Provenance]
    public let claims: [FactClaim]

    public init(facts: EnrichmentFacts, sources: [Provenance], claims: [FactClaim]) {
        self.facts = facts
        self.sources = sources
        self.claims = claims
    }

    public init(_ detail: TrackEnrichmentDetail) {
        self.init(facts: EnrichmentFacts(detail.merged), sources: detail.sources.map(Provenance.init), claims: detail.claims)
    }

    public init(_ detail: AlbumEnrichmentDetail) {
        self.init(facts: EnrichmentFacts(detail.merged), sources: detail.sources.map(Provenance.init), claims: detail.claims)
    }

    public init(_ detail: ArtistEnrichmentDetail) {
        self.init(facts: EnrichmentFacts(detail.merged), sources: detail.sources.map(Provenance.init), claims: detail.claims)
    }

    /// Nothing has been stored for this row at all: no provider asked, no claim extracted.
    public var isEmpty: Bool { sources.isEmpty && claims.isEmpty }

    public var tags: [String] { facts.genres + facts.moods }

    /// The scalars, dropping the ones nobody resolved. The release date is preferred over the year
    /// when it says more than the year alone does; it is labelled as the providers' claim because a
    /// record page also shows the year off the file itself, and the two disagree often enough.
    public var scalars: [(field: EnrichmentField, value: String)] {
        var out: [(EnrichmentField, String)] = []
        if let released = facts.releaseDate.flatMap({ $0.count > 4 ? $0 : nil }) ?? facts.year.map(String.init) {
            out.append((.released, released))
        }
        if let label = nonBlank(facts.label) { out.append((.label, label)) }
        if let bpm = facts.bpm { out.append((.bpm, formatBpm(bpm))) }
        if let key = nonBlank(facts.musicalKey) { out.append((.key, key)) }
        if let isrc = nonBlank(facts.isrc) { out.append((.isrc, isrc)) }
        return out
    }

    private func formatBpm(_ bpm: Double) -> String {
        bpm == bpm.rounded(.down) ? String(Int(bpm)) : String(format: "%.1f", bpm)
    }
}
