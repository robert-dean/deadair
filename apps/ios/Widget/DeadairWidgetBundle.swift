import SwiftUI
import WidgetKit

/// The widget extension: what the home screen draws, from the file the app writes.
///
/// iOS-only by nature, so unlike the app this target is not type-checked for the Mac. It holds no
/// decisions (`widgetReading`, `widgetAsOf` and the file itself are `DeadairCore`'s, under test) and no
/// network: it never asks the station anything, and it never fetches a cover.
@main
struct DeadairWidgetBundle: WidgetBundle {
    var body: some Widget {
        StationWidget()
    }
}
