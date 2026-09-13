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
                placeholder(String(localized: "The station keeps this for signed-in listeners. Listening itself needs no account."))
            } else if let reading = state.latest?.value {
                let ui = whatsOn(reading.now, slots: reading.slots, personas: reading.personas)
                List {
                    if state.isStale { StaleBanner() }
                    Section { OnNowCard(onNow: ui.onNow) }
                    ForEach(Array(ui.ahead.enumerated()), id: \.offset) { _, ahead in
                        Section {
                            BlockCardView(eyebrow: ahead.eyebrow, trailing: ahead.startsIn, block: ahead.block)
                        }
                    }
                }
                .opacity(state.isStale ? 0.6 : 1)
            } else if case .unreachable = state {
                placeholder(String(localized: "Can't reach the station. Pull down to try again."))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(String(localized: "What's on"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { model.schedule.retry() }
        .task(id: model.session.stored?.email) {
            model.schedule.reset()
            await model.schedule.hold()
        }
        .miniPlayer()
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

/// The first cell: the block on now with how far through it is, or the hours no block claims.
private struct OnNowCard: View {
    let onNow: OnNow

    var body: some View {
        switch onNow {
        case .live(let block, let eyebrow, let left, let progress, let takenOver):
            VStack(alignment: .leading, spacing: 8) {
                BlockCardView(eyebrow: eyebrow, trailing: left, block: block)
                ProgressView(value: progress)
                if takenOver {
                    Text(String(localized: "The station is airing something else, which is what happens when it was put on by hand. It moves back to the schedule when the next block begins."))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        case .between(let detail):
            VStack(alignment: .leading, spacing: 4) {
                Text(String(localized: "Between blocks")).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                Text(detail.words).font(.callout)
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
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(eyebrow.words).font(.caption.weight(.semibold)).foregroundStyle(.tint).textCase(.uppercase)
                Spacer()
                Text(trailing.words).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Text(block.label.words).font(.headline)
            if let line = hoursAndHost {
                Text(line).font(.subheadline).foregroundStyle(.secondary)
            }
            if let brief = block.brief {
                Text(brief).font(.footnote).foregroundStyle(.secondary)
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
