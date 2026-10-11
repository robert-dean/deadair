import ActivityKit
import DeadairCore
import SwiftUI
import WidgetKit

/// The station on the Lock Screen and in the Dynamic Island while it plays.
///
/// Drawn from `StationActivityContent`, which the app gives it and updates (`StationActivityFeed`);
/// the words are the widget's own (`widgetReading`), so the two surfaces never disagree. The cover is
/// the widget's file in the shared container, when there is one. The playhead is a
/// `ProgressView(timerInterval:)`, which moves on its own between updates, and is drawn only when the
/// station said how much of the record is left.
struct StationLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: StationActivityAttributes.self) { context in
            StationActivityLockScreen(content: context.state)
                .activityBackgroundTint(Color(uiColor: .systemBackground).opacity(0.85))
        } dynamicIsland: { context in
            let content = context.state
            let reading = widgetReading(content.state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    CoverTile(cover: coverFile(reading), spoken: reading.isSpoken, cornerRadius: 8)
                        .frame(width: 52, height: 52)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    StopButton(size: 44)
                }
                DynamicIslandExpandedRegion(.center) {
                    ActivityWords(content: content, compact: true)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ActivityPlayhead(content: content)
                }
            } compactLeading: {
                // A symbol rather than the cover: the cover drew as an empty tile at this size on the
                // simulator (2026-10-11), while the same file drew in the expanded view.
                Image(systemName: reading.isSpoken ? "mic.fill" : "radio")
                    .foregroundStyle(Color("AccentColor"))
                    .accessibilityHidden(true)
            } compactTrailing: {
                Image(systemName: content.state.playback == .playing ? "waveform" : "ellipsis")
                    .foregroundStyle(Color("AccentColor"))
                    .accessibilityHidden(true)
            } minimal: {
                Image(systemName: "radio")
                    .foregroundStyle(Color("AccentColor"))
                    .accessibilityHidden(true)
            }
        }
    }
}

/// The Lock Screen's banner: cover, words, Stop, and the playhead under them.
private struct StationActivityLockScreen: View {
    let content: StationActivityContent

    var body: some View {
        let reading = widgetReading(content.state)
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                CoverTile(cover: coverFile(reading), spoken: reading.isSpoken, cornerRadius: 8)
                    .frame(width: 56, height: 56)
                ActivityWords(content: content, compact: false)
                Spacer(minLength: 0)
                StopButton(size: 44)
            }
            ActivityPlayhead(content: content)
        }
        .padding(16)
    }
}

/// The heading, the line under it, and the station with whoever is presenting.
private struct ActivityWords: View {
    let content: StationActivityContent
    let compact: Bool

    var body: some View {
        let reading = widgetReading(content.state)
        let snapshot = content.state.snapshot
        VStack(alignment: .leading, spacing: 1) {
            Text(reading.heading(stationName: snapshot.stationName))
                .font(compact ? .subheadline.weight(.semibold) : .headline)
                .lineLimit(1)
            if let under = reading.under {
                Text(under).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            if reading.isOnAir, let footer = footer(reading, snapshot) {
                Text(footer).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The station's name, with the presenter's beside it under a record. During a break the
    /// presenter is already the heading.
    private func footer(_ reading: WidgetReading, _ snapshot: WidgetSnapshot) -> String? {
        let station = snapshot.stationName
        guard case .record = reading, let host = snapshot.host else { return station }
        guard let station else { return String(localized: "with \(host)") }
        return String(localized: "\(station) with \(host)")
    }
}

/// How far through the record, when the station said; nothing otherwise.
private struct ActivityPlayhead: View {
    let content: StationActivityContent

    var body: some View {
        if let start = content.playheadStart, let end = content.playheadEnd, start < end {
            ProgressView(timerInterval: start...end, countsDown: false) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
            .tint(Color("AccentColor"))
            .accessibilityHidden(true)
        }
    }
}

/// Stop, run in the app (see `Shared/StationIntents.swift`). The activity exists only while the
/// station plays, so there is never a Play to offer here.
private struct StopButton: View {
    let size: CGFloat

    var body: some View {
        Button(intent: StopStationIntent()) { ControlFace(symbol: "stop.fill", size: size) }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Stop the station"))
    }
}

/// The widget's cover file, when the reading names something on air and the app has written one.
private func coverFile(_ reading: WidgetReading) -> URL? {
    guard reading.isOnAir, let file = WidgetStore.shared()?.coverFile, FileManager.default.fileExists(atPath: file.path()) else { return nil }
    return file
}

extension WidgetReading {
    var isSpoken: Bool {
        if case .spoken = self { return true }
        return false
    }
}
