import DeadairCore
import DeadairSdk
import SwiftUI

/// What the enrichment providers said, as a part of a detail page: its heading, then an outlined card.
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
        SectionHeading(heading)
        // On an outlined card of its own, Android's: everything in it is somebody else's word.
        Card {
            Text(String(localized: "What the providers say")).font(.subheadline.weight(.semibold))
            switch state {
            case .loading:
                Text(String(localized: "Loading…")).font(.caption).foregroundStyle(.secondary)
            case .failed:
                Text(String(localized: "Could not load what the providers said.")).font(.caption).foregroundStyle(.red)
            case .loaded(let ui) where ui.isEmpty:
                Text(emptyMessage).font(.caption).foregroundStyle(.secondary)
            case .loaded(let ui):
                Facts(ui: ui)
            }
        }
    }
}

private struct Facts: View {
    let ui: EnrichmentUiState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !ui.tags.isEmpty {
                FlowLayout {
                    ForEach(ui.tags, id: \.self) { tag in
                        Text(tag)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(.tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }

            if !ui.scalars.isEmpty {
                FlowLayout(spacing: 24, lineSpacing: 8) {
                    ForEach(Array(ui.scalars.enumerated()), id: \.offset) { _, scalar in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(Message.field(scalar.field).words).font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                            Text(scalar.value).font(.subheadline)
                        }
                        .frame(minWidth: 96, alignment: .leading)
                    }
                }
            }

            // Above the providers' own facts, because these are the ones with a source behind them and
            // the ones the presenter reaches for first.
            ForEach(ui.claims, id: \.id) { claim in Claim(claim: claim) }

            if !ui.facts.facts.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(ui.facts.facts.enumerated()), id: \.offset) { _, fact in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("•")
                            Text(fact)
                        }
                        .font(.subheadline)
                    }
                }
            }

            if let biography = ui.facts.biography, !biography.trimmingCharacters(in: .whitespaces).isEmpty {
                Biography(text: biography)
            }

            if !ui.facts.links.isEmpty {
                FlowLayout(spacing: 16) {
                    ForEach(Array(ui.facts.links.enumerated()), id: \.offset) { _, link in
                        if let url = URL(string: link.url) { Link(link.label, destination: url).font(.subheadline.weight(.medium)) }
                    }
                }
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
}

/// One thing the station believes, and the words it read that say so. The quote is the reason this
/// exists: a claim is a sentence the presenter will say out loud, and the only way to know whether
/// it is true is to read where it came from.
private struct Claim: View {
    let claim: FactClaim
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(claim.category.replacingOccurrences(of: "_", with: " ")).font(.caption2.weight(.medium)).foregroundStyle(.tint)
            Text(claim.claim).font(.subheadline)
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
            Text(text).font(.subheadline).lineLimit(open ? nil : 4)
            Button(open ? String(localized: "Show less") : String(localized: "Read more")) { withAnimation { open.toggle() } }
                .font(.caption)
                .buttonStyle(.borderless)
        }
    }
}
