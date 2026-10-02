import DeadairCore
import DeadairSdk
import SwiftUI

/// The running order: what is airing, item by item, each saying where it has got to.
///
/// The history behind the item on air starts folded behind a count, because on a phone an hour of
/// played records is an hour of scrolling in front of the four rows that have not happened yet.
/// Folded rather than dropped: which item was skipped and where is exactly what somebody opens this
/// to find. The list opens on the anchor row and follows it as the station moves. Everything it
/// decides is `RunningOrderUiState`'s and `BroadcastUiState`'s, where the tests are.
struct UpNextScreen: View {
    @Environment(AppModel.self) private var model
    @State private var historyOpen = false

    var body: some View {
        let state = model.order.state(signedIn: model.signedIn)

        Group {
            switch state {
            case .signedOut:
                SignedOutPlaceholder()
            case .loading:
                ProgressView()
            case .unreachable:
                placeholder(String(localized: "Can't reach the station. Pull down to try again."))
            case .loaded(let reading, let stale):
                Rows(reading: reading, stale: stale, historyOpen: $historyOpen)
            }
        }
        .navigationTitle(String(localized: "Up next"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { model.order.retry() }
        // Re-held when the account changes, so an order read under one sign-in is never shown under another.
        .task(id: model.session.stored?.email) {
            model.order.reset()
            await model.order.hold()
        }
    }

    private func placeholder(_ words: String) -> some View {
        Text(words)
            .font(.callout)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The order's rows, under who is presenting it.
private struct Rows: View {
    @Environment(AppModel.self) private var model
    let reading: OrderReading
    let stale: Bool
    @Binding var historyOpen: Bool

    var body: some View {
        let ui = RunningOrderUiState(items: reading.order.items, historyOpen: historyOpen)
        let broadcast = BroadcastUiState(order: reading.order, personas: reading.personas)
        let anchorId = ui.anchorIndex.map { ui.items[$0].id }
        let station = model.settings.settings.station

        ScrollViewReader { scroller in
            List {
                if stale { StaleBanner() }

                // Who is presenting, and nothing about a broadcast that has none: off air there is
                // no one, and the line would name the station's own host over an empty order.
                if !broadcast.nothingOn {
                    Section {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(String(localized: "Host")).font(.caption).foregroundStyle(.secondary)
                            Text(broadcast.hostName.words).font(.title2.weight(.semibold)).lineLimit(1)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }

                Section {
                    // One slot above the rows: the fold while there is one, and once it is open (or there
                    // was nothing to fold) the way further back, to everything the station has played. In
                    // the same place either way, so Played is always one tap from here.
                    if let label = ui.historyLabel {
                        Button {
                            withAnimation { historyOpen = true }
                        } label: {
                            Label(label.words, systemImage: "chevron.down")
                        }
                    } else {
                        NavigationLink {
                            HistoryScreen()
                        } label: {
                            Label(String(localized: "Everything the station has played"), systemImage: "clock.arrow.circlepath")
                        }
                    }

                    if ui.items.isEmpty {
                        Text(String(localized: "The running order is empty.")).foregroundStyle(.secondary)
                    }

                    ForEach(ui.shown, id: \.id) { item in
                        OrderRow(item: item, artwork: station?.artUrl(item.artworkUrl).flatMap(URL.init(string:)), stale: stale)
                            .id(item.id)
                            .listRowBackground(item.state == .airing ? Color.accentColor.opacity(0.12) : nil)
                    }
                }
            }
            .listStyle(.insetGrouped)
            // Opened on the row the order is read from, and moved to it again when it changes: the
            // item on air is the whole point of this tab and a long order buries it. Keyed on the
            // anchor's id, so a poll that changes nothing does not pull the list back from wherever
            // the reader took it.
            .task(id: anchorId) {
                if let anchorId { scroller.scrollTo(anchorId, anchor: .top) }
            }
        }
    }
}

/// One item in the order: its picture, its title and credit, and its length, or on the item that is
/// airing a moving level meter in place of the length.
private struct OrderRow: View {
    @Environment(AppModel.self) private var model
    let item: StationOrderItem
    let artwork: URL?
    let stale: Bool

    var body: some View {
        HStack(spacing: 14) {
            // The picture first, whatever the row is. A break wears the picture its KIND was given,
            // and the console draws the same one against the same row.
            ArtworkView(url: artwork, loader: model.artwork, cornerRadius: 8, placeholderSize: 20)
                .frame(width: 52, height: 52)
                .opacity(stale ? 0.4 : 1)
                .overlay {
                    if artwork == nil && item.kind == .segment {
                        Image(systemName: "mic").foregroundStyle(.secondary)
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.body.weight(.semibold)).lineLimit(1)
                let credit = item.artists.joined(separator: ", ")
                if !credit.isEmpty {
                    Text(credit).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            let label = item.stateLabel
            if item.state == .airing {
                OnAirMeter(moving: !stale)
                    .accessibilityLabel(Text(label?.words ?? ""))
            } else if let label {
                // A row that has been handed over, played or skipped says so where the length was:
                // what happened to it is the news, and its length no longer matters.
                Text(label.words).font(.caption).foregroundStyle(.secondary)
            } else if let duration = item.durationMs {
                Text(clockOf(duration)).font(.callout.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .opacity(item.opacity)
        .accessibilityElement(children: .combine)
    }
}

/// The on-air mark: three bars rising and falling in a disc of the app's colour. It stands still
/// while the reading is stale, since a meter moving over a record that may have ended would be a
/// confident lie, and while Reduce Motion is on.
struct OnAirMeter: View {
    let moving: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Where the bars stand when the meter is still.
    private static let resting: [Double] = [0.55, 0.9, 0.7]
    /// How long each bar takes to rise, never in step with the others.
    private static let tempos: [Double] = [0.42, 0.56, 0.48]

    var body: some View {
        TimelineView(.animation(paused: !moving || reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(0..<3, id: \.self) { index in
                    let share = moving && !reduceMotion ? 0.3 + 0.7 * (0.5 + 0.5 * sin(t * .pi / Self.tempos[index] + Double(index))) : Self.resting[index]
                    Capsule().frame(width: 3, height: 15 * share)
                }
            }
            .frame(height: 15, alignment: .bottom)
            .foregroundStyle(.white)
            .frame(width: 32, height: 32)
            .background(Circle().fill(Color.accentColor))
        }
    }
}

/// Said where a signed-in screen would be, with the way to sign in beside it.
struct SignedOutPlaceholder: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 16) {
            Text(String(localized: "The station keeps this for signed-in listeners. Listening itself needs no account."))
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button(String(localized: "Sign in")) { model.tab = .settings }
                .buttonStyle(.bordered)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
