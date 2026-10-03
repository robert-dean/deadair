import DeadairCore
import DeadairSdk
import SwiftUI

/// What the station said between the records, newest first, and what came of trying.
///
/// A row is when, a lamp for how the attempt came out, who wrote it, and the words in two lines; a
/// tap opens everything else about it. Nothing here explains the writer's decisions: the reason it
/// gives is the station's own sentence, shown as it came.
struct ScriptsScreen: View {
    @Environment(AppModel.self) private var model
    let segmentId: String?
    @State private var scripts: ScriptsRepository?
    @State private var sharer = BreakSharer()

    var body: some View {
        Group {
            if let scripts {
                Attempts(scripts: scripts, sharer: sharer)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(segmentId == nil ? String(localized: "What it said") : String(localized: "One break"))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: Binding(get: { sharer.ready }, set: { sharer.ready = $0 })) { copy in
            ShareSheet(url: copy.url).presentationDetents([.medium, .large])
        }
        .sheet(item: Binding(get: { sharer.saving }, set: { sharer.saving = $0 })) { copy in
            SaveSheet(url: copy.url) { model.toasts.say(.breakSaved) }
        }
        .task(id: model.session.stored?.email) {
            // One feed per page, narrowed to the break it was opened for, and a new one for a new account.
            let session = model.session
            let feed = ScriptsRepository(segmentId: segmentId) { query in
                try await session.withSession { try await $0.render.readScriptHistory(query: query) }
            }
            scripts = feed
            await feed.hold()
        }
    }
}

private struct Attempts: View {
    @Environment(AppModel.self) private var model
    let scripts: ScriptsRepository
    let sharer: BreakSharer

    var body: some View {
        switch scripts.list(signedIn: model.signedIn) {
        case .signedOut:
            SignedOutPlaceholder(what: String(localized: "What it said"))
        case .loading:
            ProgressView()
        case .unreachable:
            ErrorPlaceholder(retry: { scripts.retry() })
        case .loaded(let attempts, _, _, _) where attempts.isEmpty:
            EmptyPlaceholder(what: String(localized: "The station has not said anything yet."))
        case .loaded(let attempts, let canLoadMore, let loadingMore, let stale):
            List {
                ForEach(attempts, id: \.id) { attempt in
                    AttemptRow(attempt: attempt, sharer: sharer, scripts: scripts)
                        .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                }
                if canLoadMore {
                    EarlierRow(loading: loadingMore) { Task { await scripts.loadMore() } }
                }
            }
            .listStyle(.plain)
            .refreshable { scripts.retry() }
            .staleBanner(stale)
        }
    }
}

private struct AttemptRow: View {
    @Environment(AppModel.self) private var model
    let attempt: ScriptAttempt
    let sharer: BreakSharer
    let scripts: ScriptsRepository
    @State private var open = false
    @State private var rating = false

    var body: some View {
        let ui = ScriptRowUiState(attempt)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                AiredText(date: attempt.at)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Circle().fill(color(ui.tone)).frame(width: 8, height: 8)
                Text(Message.outcome(attempt.outcome).words).font(.caption).foregroundStyle(.secondary)
                Text(ui.writer.words)
                    .font(.caption2.weight(.medium))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 4))
                // Only where there is audio to send: words were written and the segment is still known.
                if BreakShare.shareable(attempt) {
                    Spacer()
                    // A fixed frame, so the row does not reflow when the buttons turn into a spinner and back.
                    // Either button can be what is busy, so the one spinner stands in for both.
                    Group {
                        if sharer.busyId == attempt.id {
                            ProgressView()
                        } else {
                            HStack(spacing: 8) {
                                Button {
                                    sharer.save(attempt, with: model)
                                } label: {
                                    Image(systemName: "square.and.arrow.down")
                                }
                                .accessibilityLabel(Text(Message.saveBreak.words))
                                Button {
                                    sharer.share(attempt, with: model)
                                } label: {
                                    Image(systemName: "square.and.arrow.up")
                                }
                                .accessibilityLabel(Text(Message.shareBreak.words))
                            }
                            .buttonStyle(.borderless)
                            .disabled(sharer.busyId != nil)
                        }
                    }
                    .frame(width: 64, height: 24)
                }
            }
            Text(ui.line)
                .font(.subheadline)
                .foregroundStyle(ui.lineIsReason ? .secondary : .primary)
                .lineLimit(open ? nil : 2)
            // The operator's opinion, asked only where there are words to have one about.
            if model.isOperator, ui.rateable {
                ScriptRatingControl(rating: ui.rating, busy: rating) { mark in rate(mark) }
            }
            if open {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(ui.facts.enumerated()), id: \.offset) { _, fact in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(Message.scriptFact(fact.label).words).font(.caption2).foregroundStyle(.secondary)
                            Text(fact.value).font(.footnote)
                        }
                    }
                }
                .padding(.top, 8)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { withAnimation { open.toggle() } }
        .accessibilityElement(children: .contain)
        .accessibilityHint(open ? Text("Hide details") : Text("Show details"))
    }

    /// The station answers with the attempt as it now has it, which is swapped in at once.
    private func rate(_ mark: ScriptRating) {
        guard !rating else { return }
        rating = true
        Task {
            if let answer = await model.scriptActions.rate(attempt.id, mark) { scripts.replace(answer) }
            rating = false
        }
    }

    private func color(_ tone: ScriptTone) -> Color {
        switch tone {
        case .ok: .accentColor
        case .standby: Color(uiColor: .systemGray2)
        case .fault: .red
        }
    }
}

/// What the operator thought of something the station said.
///
/// The catalog control's mechanics and deliberately not that control: its words are claims about
/// rotation, and nothing acts on a script rating at all. Here an unrated attempt shows nothing pressed
/// and a neutral one shows the middle, because "heard it, no opinion" is a thing somebody said and
/// "nobody has listened yet" is not. `apps/android`'s `ScriptRatingControl`.
private struct ScriptRatingControl: View {
    let rating: ScriptRating?
    let busy: Bool
    let onRate: (ScriptRating) -> Void

    var body: some View {
        SegmentedChoice(
            segments: [
                .init(value: ScriptRating.disliked, symbol: "hand.thumbsdown", name: String(localized: "The station should not say things like this")),
                .init(value: .neutral, symbol: "minus.circle", name: String(localized: "Heard it, no opinion")),
                .init(value: .liked, symbol: "hand.thumbsup", name: String(localized: "More like this")),
            ],
            selected: rating,
            height: 36,
            onPick: onRate
        )
        .disabled(busy)
        .padding(.top, 2)
    }
}
