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
            SignedOutPlaceholder()
        case .loading:
            ProgressView()
        case .unreachable:
            Text(String(localized: "Can't reach the station. Pull down to try again."))
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .refreshable { scripts.retry() }
        case .loaded(let attempts, _, _, _) where attempts.isEmpty:
            Text(String(localized: "The station has not said anything yet."))
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let attempts, let canLoadMore, let loadingMore, let stale):
            List {
                if stale { StaleBanner() }
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    ForEach(attempts, id: \.id) { attempt in
                        AttemptRow(attempt: attempt, now: context.date, sharer: sharer)
                    }
                }
                if canLoadMore {
                    HStack {
                        Spacer()
                        if loadingMore {
                            ProgressView()
                        } else {
                            Button(String(localized: "Earlier")) { Task { await scripts.loadMore() } }
                        }
                        Spacer()
                    }
                }
            }
            .listStyle(.plain)
            .refreshable { scripts.retry() }
        }
    }
}

private struct AttemptRow: View {
    @Environment(AppModel.self) private var model
    let attempt: ScriptAttempt
    let now: Date
    let sharer: BreakSharer
    @State private var open = false

    var body: some View {
        let ui = ScriptRowUiState(attempt)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(Message.aired(airedLabel(attempt.at, now: now, calendar: .current)).words)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Circle().fill(color(ui.tone)).frame(width: 8, height: 8)
                Text(Message.outcome(attempt.outcome).words).font(.caption).foregroundStyle(.secondary)
                Text(ui.writer.words)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 4))
                // Only where there is audio to send: words were written and the segment is still known.
                if BreakShare.shareable(attempt) {
                    Spacer()
                    // A fixed frame, so the row does not reflow when the button turns into a spinner and back.
                    Group {
                        if sharer.busyId == attempt.id {
                            ProgressView()
                        } else {
                            Button {
                                sharer.share(attempt, with: model)
                            } label: {
                                Image(systemName: "square.and.arrow.up")
                            }
                            .buttonStyle(.borderless)
                            .disabled(sharer.busyId != nil)
                            .accessibilityLabel(Text(Message.shareBreak.words))
                        }
                    }
                    .frame(width: 32, height: 24)
                }
            }
            Text(ui.line)
                .font(.callout)
                .foregroundStyle(ui.lineIsReason ? .secondary : .primary)
                .lineLimit(open ? nil : 2)
            if open {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(ui.facts.enumerated()), id: \.offset) { _, fact in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(Message.scriptFact(fact.label).words).font(.caption2).foregroundStyle(.secondary)
                            Text(fact.value).font(.footnote)
                        }
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture { withAnimation { open.toggle() } }
        .accessibilityElement(children: .contain)
        .accessibilityHint(open ? Text("Hide details") : Text("Show details"))
    }

    private func color(_ tone: ScriptTone) -> Color {
        switch tone {
        case .ok: .accentColor
        case .standby: .gray
        case .fault: .red
        }
    }
}
