import DeadairCore
import DeadairSdk
import SwiftUI

/// The words of the record being heard, over Now playing.
///
/// Timed lines light the one being sung and keep it in view, a couple of lines from the top so what
/// comes next shows beneath it. The words are the station's, shown exactly as they came; only the
/// title and the credit under them are this app's. The lit line is worked out from the same heard
/// reading and the same projected playhead the hairline draws, twice a second.
/// `apps/android`'s `LyricsSheet`.
struct LyricsSheet: View {
    @Environment(AppModel.self) private var model
    let answer: NowPlayingLyrics?

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                let reading = model.heardState.latest
                let playhead = reading.flatMap { Playhead.project($0.value.track, readAt: $0.readAt, now: .now) }
                let state = LyricsUiState(answer: answer, heardStartedAt: reading?.value.track?.startedAt, playhead: playhead)
                content(state)
            }
            .navigationTitle("Lyrics")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private func content(_ state: LyricsUiState) -> some View {
        switch state {
        case let .synced(lines, current, provider):
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                            Text(line.text)
                                .font(.title3.weight(index == current ? .semibold : .regular))
                                .foregroundStyle(index == current ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                                .animation(.easeOut(duration: 0.25), value: current)
                                .id(index)
                        }
                        credit(provider)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .onChange(of: current, initial: true) { _, line in
                    guard let line else { return }
                    withAnimation { proxy.scrollTo(max(line - Self.linesAbove, 0), anchor: .top) }
                }
            }
        case let .plain(text, provider):
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(text).font(.body)
                    credit(provider)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
        case .hidden:
            // The airing moved on while the sheet was open, to something with no words. Nothing to
            // show until the next record's arrive; the listener closes it, or it fills again.
            Color.clear
        }
    }

    @ViewBuilder
    private func credit(_ provider: String?) -> some View {
        if let provider {
            Text("From \(provider)").font(.footnote).foregroundStyle(.secondary).padding(.top, 8)
        }
    }

    /// How many lines stay above the lit one as it is scrolled to.
    private static let linesAbove = 2
}
