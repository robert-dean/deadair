import DeadairCore
import DeadairSdk
import SwiftUI

/// What is on, what is next, and what is after that, for the signed-in account.
///
/// Every fact comes from the station's own answer and every sentence from `whatsOn`; there is no
/// local timer, so the bar and the time left move when the poll does, every half minute.
struct WhatsOnScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let state = model.schedule.state

        Group {
            if !model.signedIn {
                SignedOutPlaceholder(what: String(localized: "What's on"))
            } else if let reading = state.latest?.value {
                let ui = whatsOn(reading.now, slots: reading.slots, personas: reading.personas)
                // A column of outlined cards, Android's: one per block, on now first.
                ScrollView {
                    VStack(spacing: 12) {
                        OnNowCard(onNow: ui.onNow)
                        ForEach(Array(ui.ahead.enumerated()), id: \.offset) { _, ahead in
                            Card { BlockCardView(eyebrow: ahead.eyebrow, trailing: ahead.startsIn, block: ahead.block) }
                        }
                    }
                    .padding(16)
                }
                .refreshable { model.schedule.retry() }
                .staleBanner(state.isStale, readAt: state.latest?.readAt)
            } else if case .unreachable = state {
                ErrorPlaceholder(retry: { model.schedule.retry() })
            } else {
                ProgressView()
            }
        }
        // The station's name, as Android's bar carries it: the tab bar already says which tab this is.
        .navigationTitle(model.nowPlaying.state.latest?.value.station ?? model.settings.settings.stationName ?? String(localized: "What's on"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.session.stored?.email) {
            model.schedule.reset()
            await model.schedule.hold()
        }
    }
}

/// The first cell: the block on now with how far through it is, or the hours no block claims.
private struct OnNowCard: View {
    let onNow: OnNow

    var body: some View {
        switch onNow {
        case .live(let block, let eyebrow, let left, let progress, let takenOver):
            Card {
                BlockCardView(eyebrow: eyebrow, trailing: left, block: block)
                // Silent to VoiceOver: the time left beside the eyebrow already says how far through
                // the block it is, and a bar reading out a percentage said it twice in two units.
                ProgressView(value: progress).padding(.top, 4).accessibilityHidden(true)
                if takenOver {
                    Text(String(localized: "The station is airing something else, which is what happens when it was put on by hand. It moves back to the schedule when the next block begins."))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        case .between(let detail):
            Card {
                Eyebrow(text: String(localized: "Between blocks"), trailing: nil)
                Text(String(localized: "Nothing scheduled")).font(.callout.weight(.semibold))
                Text(detail.words).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

/// One block: what it is called, its hours, who presents it and what it was asked for.
private struct BlockCardView: View {
    let eyebrow: Message
    let trailing: Message
    let block: BlockCard

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: eyebrow.words, trailing: trailing.words)
            Text(block.label.words).font(.callout.weight(.semibold)).lineLimit(2)
            if let line = hoursAndHost {
                Text(line).font(.footnote).foregroundStyle(.secondary)
            }
            if let brief = block.brief {
                Text(brief).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// "20:00–22:00 · Cass", either half on its own, or nothing.
    private var hoursAndHost: String? {
        let hours = block.hours.map { Message.blockHours($0).words }
        switch (hours, block.host) {
        case let (hours?, host?): return String(localized: "\(hours) · \(host)")
        case let (hours?, nil): return hours
        case let (nil, host?): return host
        case (nil, nil): return nil
        }
    }
}

/// A block's eyebrow and what sits opposite it. Small, medium weight and spaced rather than shouted:
/// capitals made some screen readers spell the word out.
private struct Eyebrow: View {
    let text: String
    let trailing: String?

    var body: some View {
        HStack {
            Text(text).font(.caption2.weight(.medium)).tracking(0.9).foregroundStyle(.tint)
            Spacer()
            if let trailing, !trailing.isEmpty {
                Text(trailing).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

/// An outlined card, Android's `OutlinedCard`: the words on the page's own ground, a hairline round them.
struct Card<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(uiColor: .separator)))
    }
}
