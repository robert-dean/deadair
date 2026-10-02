import DeadairCore
import DeadairSdk
import SwiftUI

/// What the enrichment providers said, as a section of a detail page.
///
/// The console's panel with the same order and the same omissions: tags, the scalars that resolved,
/// the station's own claims with their quotes one tap away, the providers' facts, the biography
/// folded, the links, and who said all of it and when. The raw unmapped fields are left off: they
/// are a debugging affordance for a laptop.
struct EnrichmentSection: View {
    let heading: String
    let state: LoadState<EnrichmentUiState>
    let emptyMessage: String

    var body: some View {
        Section(heading) {
            switch state {
            case .loading:
                Text(String(localized: "Loading…")).font(.footnote).foregroundStyle(.secondary)
            case .failed:
                Text(String(localized: "Could not load what the providers said.")).font(.footnote).foregroundStyle(.red)
            case .loaded(let ui) where ui.isEmpty:
                Text(emptyMessage).font(.footnote).foregroundStyle(.secondary)
            case .loaded(let ui):
                Facts(ui: ui)
            }
        }
    }
}

private struct Facts: View {
    let ui: EnrichmentUiState

    var body: some View {
        if !ui.tags.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(ui.tags, id: \.self) { tag in
                        Text(tag).font(.caption).padding(.horizontal, 8).padding(.vertical, 4).background(.quaternary, in: Capsule())
                    }
                }
            }
        }

        ForEach(Array(ui.scalars.enumerated()), id: \.offset) { _, scalar in
            LabeledContent(Message.field(scalar.field).words, value: scalar.value)
        }

        // Above the providers' own facts, because these are the ones with a source behind them and
        // the ones the presenter reaches for first.
        ForEach(ui.claims, id: \.id) { claim in Claim(claim: claim) }

        ForEach(Array(ui.facts.facts.enumerated()), id: \.offset) { _, fact in
            Text("• \(fact)").font(.callout)
        }

        if let biography = ui.facts.biography, !biography.trimmingCharacters(in: .whitespaces).isEmpty {
            Biography(text: biography)
        }

        ForEach(Array(ui.facts.links.enumerated()), id: \.offset) { _, link in
            if let url = URL(string: link.url) { Link(link.label, destination: url) }
        }

        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(ui.sources.enumerated()), id: \.offset) { _, source in
                Text(Message.provenance(source).words)
                    .font(.caption2)
                    .foregroundStyle(source.failed ? Color.orange : Color.secondary)
            }
        }
    }
}

/// One thing the station believes, and the words it read that say so. The quote is the reason this
/// exists: a claim is a sentence the presenter will say out loud, and the only way to know whether
/// it is true is to read where it came from.
private struct Claim: View {
    let claim: FactClaim
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(claim.category.replacingOccurrences(of: "_", with: " ")).font(.caption2).foregroundStyle(.tint).textCase(.uppercase)
            Text(claim.claim).font(.callout)
            Button(open ? String(localized: "Hide the source") : String(localized: "Show the source")) { withAnimation { open.toggle() } }
                .font(.caption)
                .buttonStyle(.borderless)
            if open {
                Text("“\(claim.sourceQuote)”").font(.footnote).italic().foregroundStyle(.secondary)
                if let url = URL(string: claim.sourceUrl) {
                    Link(claim.sourceUrl, destination: url).font(.caption).lineLimit(1)
                }
            }
        }
    }
}

private struct Biography: View {
    let text: String
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(text).font(.callout).lineLimit(open ? nil : 4)
            Button(open ? String(localized: "Show less") : String(localized: "Read more")) { withAnimation { open.toggle() } }
                .font(.caption)
                .buttonStyle(.borderless)
        }
    }
}
