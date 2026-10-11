import DeadairCore
import SwiftUI
import UIKit
import WidgetKit

/// The station on the home screen: what is on, who is on the mic, and Play or Stop.
///
/// Small and medium, as Android's is one size that stretches. The timeline is one entry from the file,
/// plus one more at the moment the reading's age starts to show (`widgetRedrawAt`), and `.never`
/// after that: the app reloads it whenever it writes, and there is nothing else that could change
/// what it says.
struct StationWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetStore.kind, provider: StationTimeline()) { entry in
            StationWidgetView(entry: entry)
        }
        .configurationDisplayName("deadair")
        .description("What the station is playing, and a way to start it.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct StationEntry: TimelineEntry {
    let date: Date
    let state: WidgetState
    /// The cover file, when there is one and the reading names something on air.
    let cover: URL?
}

struct StationTimeline: TimelineProvider {
    func placeholder(in context: Context) -> StationEntry {
        StationEntry(
            date: .now,
            state: WidgetState(snapshot: WidgetSnapshot(stationName: "deadair", onAir: true, kind: .record, title: "Now playing", artist: "deadair", readAt: .now), playback: .playing, hasStation: true),
            cover: nil
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (StationEntry) -> Void) {
        completion(entry(at: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StationEntry>) -> Void) {
        let now = Date.now
        let first = entry(at: now)
        var entries = [first]
        if let later = widgetRedrawAt(first.state, now: now) {
            entries.append(StationEntry(date: later, state: first.state, cover: first.cover))
        }
        completion(Timeline(entries: entries, policy: .never))
    }

    /// The file as the app last wrote it. No file (the app has not run since the widget was added, or
    /// the build has no App Group) reads as no station, which sends the listener to the app.
    private func entry(at date: Date) -> StationEntry {
        let store = WidgetStore.shared()
        let state = store?.read() ?? WidgetState()
        let cover = store.map(\.coverFile).flatMap { FileManager.default.fileExists(atPath: $0.path()) ? $0 : nil }
        return StationEntry(date: date, state: state, cover: widgetReading(state).isOnAir ? cover : nil)
    }
}

struct StationWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: StationEntry

    private var reading: WidgetReading { widgetReading(entry.state) }

    var body: some View {
        Group {
            if family == .systemMedium { medium } else { small }
        }
        .containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .top) {
                CoverTile(cover: entry.cover, spoken: isSpoken).frame(width: 56, height: 56)
                Spacer(minLength: 4)
                control
            }
            Spacer(minLength: 4)
            words(headingFont: .subheadline.weight(.semibold))
        }
    }

    private var medium: some View {
        HStack(spacing: 14) {
            CoverTile(cover: entry.cover, spoken: isSpoken)
            VStack(alignment: .leading, spacing: 2) {
                words(headingFont: .headline)
                Spacer(minLength: 4)
                HStack(alignment: .bottom) {
                    Spacer(minLength: 0)
                    control
                }
            }
        }
    }

    /// The heading, the line under it, and the station's name or the reading's age.
    private func words(headingFont: Font) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(reading.heading(stationName: entry.state.snapshot.stationName))
                .font(headingFont)
                .lineLimit(2)
            if let under = reading.under {
                Text(under).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            footer.font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
        }
    }

    /// The station's name under a record, since the heading is the record's; or, when the reading is
    /// old enough to be wrong, when it was taken.
    @ViewBuilder
    private var footer: some View {
        if let asOf = widgetAsOf(entry.state, now: entry.date) {
            Text("as of \(asOf.formatted(date: .omitted, time: .shortened))")
        } else if reading.isOnAir, let name = entry.state.snapshot.stationName {
            Text(name)
        }
    }

    /// Play while stopped, Stop otherwise. Both run in the app (see `Shared/StationIntents.swift`).
    @ViewBuilder
    private var control: some View {
        if entry.state.hasStation {
            if entry.state.playback == .stopped {
                Button(intent: PlayStationIntent()) { ControlFace(symbol: "play.fill") }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Play the station"))
            } else {
                Button(intent: StopStationIntent()) { ControlFace(symbol: "stop.fill") }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Stop the station"))
            }
        }
    }

    private var isSpoken: Bool {
        if case .spoken = reading { return true }
        return false
    }
}

private struct ControlFace: View {
    let symbol: String

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 40, height: 40)
            .background(Circle().fill(Color("AccentColor")))
    }
}

/// The cover read off disk, or the radio (the mic during a break) when there is none.
private struct CoverTile: View {
    let cover: URL?
    let spoken: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10).fill(.quaternary)
            if let cover, let image = UIImage(contentsOfFile: cover.path()) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: spoken ? "mic" : "radio").font(.title2).foregroundStyle(.secondary)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .accessibilityHidden(true)
    }
}
