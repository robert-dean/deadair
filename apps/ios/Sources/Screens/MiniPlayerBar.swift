import DeadairCore
import SwiftUI

extension View {
    /// The player bar along the bottom of a tab that is not Now playing.
    func miniPlayer() -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) { MiniPlayerBar() }
    }
}

/// What is on air, and the one button, along the bottom of every tab but Now playing.
///
/// Leaving Now playing would otherwise leave no way to stop the station but going back to it. Not
/// on Now playing itself, whose own button is a thumb away: two live stop controls on one screen is
/// one too many. Not on pushed pages either, as on Android: each is an errand somebody goes and does
/// and comes back from, and the lock screen is the control there. Every word comes from the same
/// `NowPlayingUiState` the full screen reads, so the two cannot disagree about what is on.
///
/// It holds its own poll lease: the root's `.task` is cancelled when a screen is pushed over it, and
/// without one this bar would go on showing a reading nobody was refreshing.
///
/// The second line is the station's words only (a credit, a break's label), or the player's own
/// short state while it reconnects. The app's own second lines are whole sentences, and cut to one
/// line in a bar they lose the half that says what to do; `apps/android`'s bar measured that.
struct MiniPlayerBar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let ui = model.nowPlayingUi
        let listening = model.listening
        let reading = model.nowPlaying.state.latest?.value

        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 12) {
                // The artwork and the words are one target, which opens Now playing; the button beside
                // them is its own. A tap meant for the words must never stop the station.
                Button {
                    model.tab = .nowPlaying
                } label: {
                    HStack(spacing: 12) {
                        ArtworkView(url: artworkURL(station: model.settings.settings.station, reading: reading), loader: model.artwork, cornerRadius: 6, placeholderSize: 20)
                            .frame(width: 44, height: 44)
                            .opacity(ui.stale ? 0.4 : 1)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(ui.title.words).font(.body.weight(.semibold)).lineLimit(1)
                            if let second = secondLine(ui: ui, state: listening.conductor.state) {
                                Text(second).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityHint(Text("Opens Now playing"))

                Button {
                    listening.wantsToPlay ? listening.stop() : listening.play()
                } label: {
                    Image(systemName: listening.wantsToPlay ? "stop.fill" : "play.fill")
                        .font(.system(size: 20))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.borderedProminent)
                .clipShape(Circle())
                .accessibilityLabel(listening.wantsToPlay ? Text("Stop") : Text("Play"))
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(.bar)
        .task { await model.nowPlaying.hold() }
    }

    private func secondLine(ui: NowPlayingUiState, state: ListeningState) -> String? {
        switch state {
        case .reconnecting, .unreachable: state.words
        case .stopped, .warmingUp, .playing: ui.subtitleScrolls ? ui.subtitle?.words : nil
        }
    }
}
