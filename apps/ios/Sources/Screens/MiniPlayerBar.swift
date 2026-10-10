import DeadairCore
import SwiftUI

extension View {
    /// The player bar along the bottom of a tab that is not Now playing.
    func miniPlayer() -> some View {
        // Filling the screen first, so a tab that is only a spinner still has the bar along the bottom
        // rather than wrapped round the spinner in the middle.
        frame(maxWidth: .infinity, maxHeight: .infinity)
            .safeAreaInset(edge: .bottom, spacing: 0) { MiniPlayerBar() }
    }
}

/// What is on air, and the one button, along the bottom of What's on.
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
    @Environment(\.colorScheme) private var colorScheme

    /// What reads on the app's green, which is pale in the dark and deep in the light.
    private var onAccent: Color { colorScheme == .dark ? Color(white: 0.06) : .white }

    var body: some View {
        let ui = model.nowPlayingUi
        let listening = model.listening
        let reading = model.heardState.latest?.value

        HStack(spacing: 12) {
            // The artwork and the words are one target, which opens Now playing; the button beside
            // them is its own. A tap meant for the words must never stop the station.
            Button {
                model.tab = .nowPlaying
            } label: {
                HStack(spacing: 12) {
                    ArtworkView(
                        url: artworkURL(station: model.settings.settings.station, reading: reading), loader: model.artwork, cornerRadius: 4,
                        placeholderSize: 22, dimmed: ui.stale
                    )
                    .frame(width: 48, height: 48)

                    VStack(alignment: .leading, spacing: 0) {
                        Text(ui.title.words).font(.body).lineLimit(1)
                        if let second = secondLine(ui: ui, state: listening.conductor.state) {
                            Text(second).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint(Text("Opens Now playing"))

            // The same button as Now playing's, flat: a glow on a small button in a strip of chrome
            // is a smudge.
            Button {
                listening.wantsToPlay ? listening.stop() : listening.play()
            } label: {
                ZStack {
                    Circle().fill(.tint)
                    if listening.conductor.state == .warmingUp {
                        ProgressView().tint(onAccent)
                    } else {
                        Image(systemName: listening.wantsToPlay ? "stop.fill" : "play.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(onAccent)
                    }
                }
                .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(listening.wantsToPlay ? Text("Stop listening") : Text("Play"))
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .frame(minHeight: 64)
        .background(Color(uiColor: .secondarySystemBackground))
        .task { await model.nowPlaying.hold() }
    }

    private func secondLine(ui: NowPlayingUiState, state: ListeningState) -> String? {
        switch state {
        case .reconnecting, .unreachable: state.words
        case .stopped, .warmingUp, .playing: ui.subtitleScrolls ? ui.subtitle?.words : nil
        }
    }
}
