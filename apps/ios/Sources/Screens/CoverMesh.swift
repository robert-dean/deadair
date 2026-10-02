import DeadairCore
import SwiftUI

extension Color {
    init(rgb: RGB) {
        self.init(red: Double((rgb >> 16) & 0xFF) / 255, green: Double((rgb >> 8) & 0xFF) / 255, blue: Double(rgb & 0xFF) / 255)
    }
}

/// The on-air cover's colours, read once per record and per light or dark page.
///
/// A blurred, scaled copy of the cover was tried on Android first and is the wrong tool: at screen size
/// the blur was weak and the cover's shapes showed through as bands and blotches. So the colours are
/// read off the picture and the decisions are `CoverPalette`'s, where the tests are.
@MainActor
@Observable
final class CoverPaletteReader {
    private(set) var palette: CoverPalette?
    @ObservationIgnored private var readFor: String?

    func read(_ url: URL?, darkPage: Bool, loader: ArtworkLoader) async {
        let key = url.map { "\($0.absoluteString)|\(darkPage)" }
        guard key != readFor else { return }
        readFor = key
        guard let url, let image = await loader.image(for: url) else {
            palette = nil
            return
        }
        let candidates = Platform.coverColors(image)
        guard readFor == key else { return }
        withAnimation(.easeInOut(duration: 0.8)) { palette = CoverPalette(candidates: candidates, darkPage: darkPage) }
    }
}

/// Four soft blobs of the cover's colours behind the page. They drift while the station is airing, and
/// stand still with Reduce Motion on or when told to (Up next, where colour moving at the top of a list
/// pulls the eye off the rows). `apps/android`'s `CoverMesh`.
struct CoverMesh: View {
    let colors: [RGB]
    var moving: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Where each blob rests, as a fraction of the page, and how far it wanders.
    private static let anchors: [(x: Double, y: Double)] = [(0.2, 0.15), (0.85, 0.25), (0.3, 0.65), (0.8, 0.8)]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !moving || reduceMotion)) { context in
            let t = moving && !reduceMotion ? context.date.timeIntervalSinceReferenceDate : 0
            GeometryReader { geometry in
                ZStack {
                    ForEach(Array(colors.prefix(meshBlobs).enumerated()), id: \.offset) { index, rgb in
                        let anchor = Self.anchors[index % Self.anchors.count]
                        let drift = 0.08
                        let x = anchor.x + drift * sin(t / (11 + Double(index) * 3) + Double(index))
                        let y = anchor.y + drift * cos(t / (13 + Double(index) * 2) + Double(index) * 2)
                        Circle()
                            .fill(Color(rgb: rgb))
                            .frame(width: geometry.size.width * 0.9, height: geometry.size.width * 0.9)
                            .position(x: geometry.size.width * x, y: geometry.size.height * y)
                    }
                }
                .blur(radius: geometry.size.width * 0.18)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}
