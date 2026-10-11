import DeadairCore
import DeadairSdk
import SwiftUI

/// The words of the record being heard, over Now playing.
///
/// Timed lines light the one being sung and keep it in view, a couple of lines from the top so what
/// comes next shows beneath it. When the source timed its words, the part of that line already sung
/// is painted in the page's accent with a soft glow, word by word; a line timed only as a line is lit
/// whole, as it always was. The words are the station's, shown exactly as they came; only the title
/// and the credit under them are this app's. The lit line is worked out from the same heard reading
/// and the same projected playhead the hairline draws, ten times a second while the sheet is up,
/// because a word lasts a few hundred milliseconds and a half-second tick lands it late or skips it.
/// The sheet is the only place that runs that fast. `apps/android`'s `LyricsSheet`.
struct LyricsSheet: View {
    @Environment(AppModel.self) private var model
    let answer: NowPlayingLyrics?
    /// Now playing's accent, from the cover: a sheet is presented outside that page's `tint`.
    var accent: Color = .accentColor

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 0.1)) { _ in
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
        case let .synced(lines, current, provider, sung):
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                            if index == current, let sung {
                                sungLine(line.text, sung: sung)
                                    .font(.title3.weight(.semibold))
                                    .id(index)
                            } else {
                                Text(line.text)
                                    .font(.title3.weight(index == current ? .semibold : .regular))
                                    .foregroundStyle(index == current ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                                    .animation(.easeOut(duration: 0.25), value: current)
                                    .id(index)
                            }
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

    /// A line with its first `sung` characters in the accent and the rest in the primary colour, over a
    /// copy of itself in which only the sung part is drawn, blurred into a soft glow. The two layers are
    /// the same string in the same font, so they lay out identically and the glow sits behind the
    /// letters that are lit and nowhere else.
    private func sungLine(_ text: String, sung: Int) -> some View {
        let split = text.index(text.startIndex, offsetBy: min(sung, text.count))
        let lit = String(text[..<split])
        let rest = String(text[split...])
        return (Text(lit).foregroundStyle(accent) + Text(rest).foregroundStyle(.primary))
            .background(alignment: .topLeading) {
                (Text(lit).foregroundStyle(accent) + Text(rest).foregroundStyle(.clear))
                    .blur(radius: Self.glowRadius)
                    .opacity(Self.glowOpacity)
                    .accessibilityHidden(true)
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

    /// How far the glow behind the sung words spreads, in points, and how strong it is.
    private static let glowRadius: CGFloat = 6
    private static let glowOpacity = 0.8
}
